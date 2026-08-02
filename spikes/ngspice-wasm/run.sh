#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${NGSPICE_WASM_PACKAGE:-eecircuit-engine}"
VERSION="${NGSPICE_WASM_VERSION:-1.7.0}"
LICENSE="${NGSPICE_WASM_LICENSE:-MIT}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

(
  cd "$OUT"
  npm pack "$PACKAGE@$VERSION" >/dev/null
  tar -xzf "$PACKAGE-$VERSION.tgz"
  cat > run.mjs <<'NODE'
import { Simulation } from "./package/dist/eecircuit-engine.mjs";

const simulation = new Simulation();
await simulation.start();
simulation.setNetList(`V1 in 0 PULSE(0 1 0 1u 1u 5m 10m)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 20m
.end`);
const result = await simulation.runSim();
if (result.dataType !== "real" || result.numPoints <= 0) {
  throw new Error("transient simulation did not produce real samples");
}
console.log(
  JSON.stringify({
    dataType: result.dataType,
    numPoints: result.numPoints,
    variableNames: result.variableNames,
  }),
);
NODE
  node run.mjs
)
echo "ngspice-compatible WASM spike passed"
echo "package=$PACKAGE@$VERSION license=$LICENSE"
