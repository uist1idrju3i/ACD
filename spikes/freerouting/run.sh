#!/usr/bin/env bash
set -euo pipefail

IMAGE="${FREEROUTING_IMAGE:-ghcr.io/freerouting/freerouting:2.2.4}"
IMAGE_DIGEST="${FREEROUTING_DIGEST:-sha256:0d010c6bf13b562551e8cb41fb298090006033fa2850e5bfc678c98ecf47111e}"
SOURCE_URL="https://raw.githubusercontent.com/freerouting/freerouting/master/scripts/benchmark/fixtures/KiCad_10_demos/multichannel_mixer-unrouted.dsn"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: Docker unavailable"
  exit 0
fi

docker pull "$IMAGE" >/dev/null
actual="$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}')"
test "$actual" = "ghcr.io/freerouting/freerouting@$IMAGE_DIGEST"
curl --fail --location --silent --show-error "$SOURCE_URL" -o "$OUT/input.dsn"
docker run --rm \
  -e HOME=/tmp \
  -v "$OUT:/work" \
  "$IMAGE" \
  java -jar /app/freerouting-executable.jar \
  -de /work/input.dsn -do /work/output.ses -l en -mp 1
test -s "$OUT/output.ses"
echo "Freerouting DSN/SES spike passed"
echo "image=$actual"
echo "input=$SOURCE_URL"
echo "output=$OUT/output.ses"
