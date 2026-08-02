#!/usr/bin/env bash
set -euo pipefail

IMAGE="${KICAD_IMAGE:-kicad/kicad:10.0}"
OUT="${KICAD_OUT:-artifacts/kicad}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "SKIP: Docker or KiCad image unavailable: $IMAGE"
  exit 0
fi

rm -rf "$ROOT/$OUT"
mkdir -p "$ROOT/$OUT/project" "$ROOT/$OUT/reports" "$ROOT/$OUT/gerbers" "$ROOT/$OUT/drill"
pnpm exec tsx "$ROOT/scripts/project-graph.mts" \
  "$ROOT/fixtures/design-graphs/normal-2layer.json" "$ROOT/$OUT/project" >/dev/null

docker_run() {
  docker run --rm \
    --user root \
    -e HOME=/tmp \
    -e KICAD_CONFIG_HOME=/tmp/kicad-config \
    -v "$ROOT/$OUT:/work" \
    "$IMAGE" "$@"
}

docker_run kicad-cli --version | tee "$ROOT/$OUT/capability.txt"
docker_run kicad-cli --help > "$ROOT/$OUT/kicad-cli-help.txt"
set +e
docker_run kicad-cli pcb drc \
  --output /work/reports/drc.rpt /work/project/design.kicad_pcb \
  2> "$ROOT/$OUT/reports/drc.stderr"
drc_status=$?
set -e
if [ ! -f "$ROOT/$OUT/reports/drc.rpt" ]; then
  echo "::error file=scripts/kicad-spike.sh::KiCad DRC stderr: $(tr '\n' ';' < "$ROOT/$OUT/reports/drc.stderr")"
  echo "KiCad DRC did not produce a report"
  exit "$drc_status"
fi
if grep -Eq 'Found [1-9][0-9]* (DRC violations|unconnected items)' "$ROOT/$OUT/reports/drc.rpt"; then
  echo "::error file=scripts/kicad-spike.sh::DRC report contains: $(grep -E 'Found [1-9][0-9]* (DRC violations|unconnected items)' "$ROOT/$OUT/reports/drc.rpt" | tr '\n' ';')"
  exit 4
fi
docker_run kicad-cli pcb export gerbers \
  -o /work/gerbers/ /work/project/design.kicad_pcb
docker_run kicad-cli pcb export drill \
  -o /work/drill/ /work/project/design.kicad_pcb
docker_run kicad-cli pcb export step \
  -o /work/board.step /work/project/design.kicad_pcb
set +e
docker_run kicad-cli sch erc \
  --output /work/reports/erc.rpt /work/project/design.kicad_sch \
  2> "$ROOT/$OUT/reports/erc.stderr"
erc_status=$?
set -e
if [ ! -f "$ROOT/$OUT/reports/erc.rpt" ]; then
  echo "KiCad ERC did not produce a report"
  exit "$erc_status"
fi
if grep -Eq 'ERC messages: [1-9][0-9]*' "$ROOT/$OUT/reports/erc.rpt"; then
  echo "ERC report contains violations"
  exit 4
fi
find "$ROOT/$OUT" -type f \
  ! -name 'SHA256SUMS' ! -name 'STABLE-SHA256SUMS' -print0 |
  sort -z | xargs -0 sha256sum > "$ROOT/$OUT/SHA256SUMS"
while IFS= read -r -d '' artifact; do
  normalized="$(mktemp)"
  sed -E \
    -e 's/^%TF\.CreationDate,.*/%TF.CreationDate,TIMESTAMP*%/' \
    -e 's/^G04 Created by KiCad .* date .*\*/G04 Created by KiCad date TIMESTAMP*/' \
    -e 's/^; DRILL file KiCad .* date .*/; DRILL file KiCad date TIMESTAMP/' \
    -e 's/^; #@! TF\.CreationDate,.*/; #@! TF.CreationDate,TIMESTAMP/' \
    -e "s/^FILE_NAME\\('board.step','[^']*'/FILE_NAME('board.step','TIMESTAMP'/" \
    -e 's/^\*\* Created on .*\*\*/** Created on TIMESTAMP **/' \
    -e 's/^ERC report [(][^,]*,/ERC report (TIMESTAMP,/' \
    "$artifact" > "$normalized"
  sha256sum "$normalized" | sed "s#${normalized}#${artifact}#"
  rm -f "$normalized"
done < <(find "$ROOT/$OUT" -type f \
  ! -name 'SHA256SUMS' ! -name 'STABLE-SHA256SUMS' \
  \( -name '*.gbr' -o -name '*.gtl' -o -name '*.gbl' -o -name '*.gto' \
  -o -name '*.gbo' -o -name '*.gm1' -o -name '*.drl' -o -name '*.step' \
  -o -name '*.rpt' \) -print0 | sort -z) > "$ROOT/$OUT/STABLE-SHA256SUMS"
echo "KiCad spike completed: $ROOT/$OUT"
