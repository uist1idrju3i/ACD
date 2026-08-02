import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const fixturePath = resolve(process.argv[2] ?? "fixtures/phase1/smoke.json");
const outputPath = resolve(process.argv[3] ?? "artifacts/phase1-smoke/smoke.dsn");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const placement = new Map(
  fixture.placementConstraints.components.map((component) => [component.partId, component]),
);
const parts = new Map(fixture.parts.map((part) => [part.id, part]));
const mappings = new Map(fixture.mappings.map((mapping) => [mapping.partId, mapping]));
const padGeometry = {
  "part:j1": { 1: [0, -1000], 2: [0, 1000] },
  "part:r1": { 1: [-750, 0], 2: [750, 0] },
  "part:d1": { 1: [-750, 0], 2: [750, 0] },
  "part:c1": { 1: [-750, 0], 2: [750, 0] },
};
const nets = fixture.nets.map((net) => ({
  ...net,
  pins: net.pins.map((pin) => `${parts.get(pin.partId).reference}-${pin.pin}`),
}));

const imageFor = (partId) => {
  const mapping = mappings.get(partId);
  if (!mapping) throw new Error(`missing mapping for ${partId}`);
  return `${mapping.footprintLibraryId}:${mapping.footprintName}`;
};
const pinsFor = (partId) => {
  const mapping = mappings.get(partId);
  if (!mapping) throw new Error(`missing mapping for ${partId}`);
  const offsets = padGeometry[partId];
  if (!offsets) throw new Error(`unsupported spike geometry for ${partId}`);
  return mapping.pinPads
    .map((pinPad) => {
      const offset = offsets[pinPad.pad];
      if (!offset) throw new Error(`unsupported spike geometry for ${partId} pad ${pinPad.pad}`);
      const [x, y] = offset;
      return `      (pin Rect[A]Pad_1200.000000x1200.000000_um ${pinPad.pad} ${x} ${y})`;
    })
    .join("\n");
};
const partsByImage = new Map();
for (const partId of parts.keys()) {
  const image = imageFor(partId);
  const grouped = partsByImage.get(image) ?? [];
  grouped.push(partId);
  partsByImage.set(image, grouped);
}
const imageBlocks = [...partsByImage.entries()]
  .map(([image, partIds]) => {
    return `    (image "${image}"
      (outline (rect signal -1200 -1200 1200 1200))
${pinsFor(partIds[0])}
    )`;
  })
  .join("\n");
const placements = [...partsByImage.entries()]
  .map(([image, partIds]) => {
    const places = partIds
      .map((partId) => {
        const part = parts.get(partId);
        const position = placement.get(partId);
        if (!position) throw new Error(`missing placement for ${partId}`);
        return `      (place ${part.reference} ${Math.round(position.xMm * 1000)} ${Math.round(position.yMm * 1000)} front ${position.rotationDeg} (PN ${part.reference}))`;
      })
      .join("\n");
    return `    (component "${image}"
${places}
    )`;
  })
  .join("\n");
const network = nets
  .map((net) => `    (net "${net.name}"\n      (pins ${net.pins.join(" ")})\n    )`)
  .join("\n");
const dsn = `(pcb "acd-phase1-smoke"
  (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "ACD") (host_version "phase1-smoke"))
  (resolution um 1)
  (unit um)
  (structure
    (layer F.Cu (type signal) (property (index 0)))
    (layer B.Cu (type signal) (property (index 1)))
    (boundary (path pcb 0 0 0 20000 0 20000 15000 0 15000 0 0))
    (via "Via_1200")
    (rule (width 500) (clearance 200))
  )
  (placement
${placements}
  )
  (library
${imageBlocks}
    (padstack Rect[A]Pad_1200.000000x1200.000000_um
      (shape (rect F.Cu -600 -600 600 600))
      (shape (rect B.Cu -600 -600 600 600))
      (attach off)
    )
    (padstack "Via_1200"
      (shape (circle F.Cu 1200))
      (shape (circle B.Cu 1200))
      (attach off)
    )
  )
  (network
${network}
  )
  (wiring)
)
`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, dsn, "utf8");
process.stdout.write(`wrote ${outputPath}\n`);
