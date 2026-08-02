#!/usr/bin/env bash
set -euo pipefail
current_step="initialization"
trap 'status=$?; echo "::error file=scripts/kicad-spike.sh::KiCad spike failed during ${current_step} with exit status ${status}"; exit "$status"' ERR

IMAGE="${KICAD_IMAGE:-kicad/kicad:10.0}"
OUT="${KICAD_OUT:-artifacts/kicad}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "SKIP: Docker or KiCad image unavailable: $IMAGE"
  exit 0
fi

rm -rf "$ROOT/$OUT"
mkdir -p "$ROOT/$OUT/project" "$ROOT/$OUT/reports" "$ROOT/$OUT/gerbers" "$ROOT/$OUT/drill"
pnpm --filter @acd/adapter-kicad build >/dev/null
node --input-type=module - "$ROOT/$OUT/project" <<'NODE'
import { projectToKicad } from "./packages/adapters/kicad/dist/projection.js";
const directory = process.argv[2];
await projectToKicad({
  schemaVersion: "0.1.0-draft",
  project: { id: "project:normal-2layer", type: "Project", revision: 0 },
  entities: [{ id: "project:normal-2layer", type: "Project", revision: 0 }]
}, directory);
NODE

current_step="capability version"
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli --version | tee "$ROOT/$OUT/capability.txt"
current_step="capability help"
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli --help > "$ROOT/$OUT/kicad-cli-help.txt"
current_step="DRC"
set +e
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli pcb drc \
  --output /work/reports/drc.rpt /work/project/design.kicad_pcb
drc_status=$?
set -e
if [ "$drc_status" -ne 0 ] && ! grep -Eq 'Found [1-9][0-9]* (DRC violations|unconnected items)' "$ROOT/$OUT/reports/drc.rpt"; then
  echo "KiCad DRC command failed without reported violations"
  exit "$drc_status"
fi
if grep -Eq 'Found [1-9][0-9]* (DRC violations|unconnected items)' "$ROOT/$OUT/reports/drc.rpt"; then
  echo "DRC report contains violations"
  exit 4
fi
current_step="Gerber export"
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli pcb export gerbers \
  -o /work/gerbers/ /work/project/design.kicad_pcb
current_step="drill export"
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli pcb export drill \
  -o /work/drill/ /work/project/design.kicad_pcb
current_step="STEP export"
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli pcb export step \
  -o /work/board.step /work/project/design.kicad_pcb
current_step="ERC"
set +e
docker run --rm -v "$ROOT/$OUT:/work" "$IMAGE" kicad-cli sch erc \
  --output /work/reports/erc.rpt /work/project/design.kicad_sch
erc_status=$?
set -e
if [ "$erc_status" -ne 0 ] && ! grep -Eq 'ERC messages: [1-9][0-9]*' "$ROOT/$OUT/reports/erc.rpt"; then
  echo "KiCad ERC command failed without reported violations"
  exit "$erc_status"
fi
if grep -Eq 'ERC messages: [1-9][0-9]*' "$ROOT/$OUT/reports/erc.rpt"; then
  echo "ERC report contains violations"
  exit 4
fi
current_step="artifact manifests"
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
