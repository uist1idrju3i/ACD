import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignGraph } from "@acd/graph-core";
import type { Phase1Fixture } from "@acd/schema";
import { projectGraphToKicad } from "./graph-projection.js";
import {
  renderFootprintLibraryTable,
  renderProject,
  renderSymbolLibraryTable,
} from "./project-files.js";
import { renderLabel, renderSymbolInstance } from "./schematic-elements.js";
import { smokeLibrarySymbols } from "./symbol-library.js";

const uuid = "00000000-0000-4000-8000-000000000001";

const isPhase1Fixture = (input: DesignGraph | Phase1Fixture): input is Phase1Fixture =>
  "fixtureKind" in input && "parts" in input && "mappings" in input;

export class KicadProjectionError extends Error {
  readonly code = "projection-geometry-unsupported";
  readonly name = "KicadProjectionError";
}

const padGeometry: Record<string, Record<string, [number, number]>> = {
  "part:j1": { "1": [0, -1], "2": [0, 1] },
  "part:r1": { "1": [-0.75, 0], "2": [0.75, 0] },
  "part:d1": { "1": [-0.75, 0], "2": [0.75, 0] },
  "part:c1": { "1": [-0.75, 0], "2": [0.75, 0] },
};

const padOffset = (partId: string, pad: string): [number, number] => {
  const geometry = padGeometry[partId]?.[pad];
  if (!geometry) {
    throw new KicadProjectionError(`unsupported spike geometry for ${partId} pad ${pad}`);
  }
  return geometry;
};

const renderSmokeFootprint = (
  fixture: Phase1Fixture,
  partId: string,
  x: number,
  y: number,
  rotation: number,
  netByPin: Map<string, { code: number; name: string }>,
): string => {
  const part = fixture.parts.find((candidate) => candidate.id === partId);
  const mapping = fixture.mappings.find((candidate) => candidate.partId === partId);
  if (!part || !mapping) throw new Error(`missing Phase 1 mapping for ${partId}`);
  const pads = mapping.pinPads
    .map((pinPad) => {
      const net = netByPin.get(`${partId}:${pinPad.pin}`);
      if (!net) throw new Error(`unresolved net for ${partId} pin ${pinPad.pin}`);
      const offset = padOffset(partId, pinPad.pad);
      if (!offset)
        throw new KicadProjectionError(
          `unsupported spike geometry for ${partId} pad ${pinPad.pad}`,
        );
      const [offsetX, offsetY] = offset;
      return `    (pad "${pinPad.pad}" smd roundrect (at ${offsetX} ${offsetY}) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net.code} "${net.name}"))`;
    })
    .join("\n");
  return `  (footprint "${mapping.footprintName}"
    (layer "F.Cu")
    (at ${x} ${y} ${rotation})
    (property "Reference" "${part.reference}" (at 0 -1.8 ${rotation}) (layer "F.Fab") hide)
    (property "Value" "${part.mpn}" (at 0 1.8 ${rotation}) (layer "F.Fab") hide)
${pads}
  )`;
};

const padPosition = (fixture: Phase1Fixture, partId: string, pad: string): [number, number] => {
  const placement = fixture.placementConstraints.components.find(
    (candidate) => candidate.partId === partId,
  );
  if (!placement) throw new KicadProjectionError(`missing placement for ${partId}`);
  const offset = padOffset(partId, pad);
  if (!offset)
    throw new KicadProjectionError(`unsupported spike geometry for ${partId} pad ${pad}`);
  const [localX, localY] = offset;
  const radians = (placement.rotationDeg * Math.PI) / 180;
  return [
    placement.xMm + localX * Math.cos(radians) + localY * Math.sin(radians),
    placement.yMm - localX * Math.sin(radians) + localY * Math.cos(radians),
  ];
};

export const renderSmokeBoard = (fixture: Phase1Fixture): string => {
  if (fixture.fixtureKind !== "smoke") {
    throw new KicadProjectionError(
      `Phase 1 board projection currently supports fixtureKind=smoke, received ${fixture.fixtureKind}`,
    );
  }
  const netByPin = new Map<string, { code: number; name: string }>();
  const netLines = fixture.nets.map((net, index) => {
    const code = index + 1;
    for (const pin of net.pins) netByPin.set(`${pin.partId}:${pin.pin}`, { code, name: net.name });
    return `  (net ${code} "${net.name}")`;
  });
  const footprints = fixture.placementConstraints.components
    .map((placement) => {
      return renderSmokeFootprint(
        fixture,
        placement.partId,
        placement.xMm,
        placement.yMm,
        placement.rotationDeg,
        netByPin,
      );
    })
    .join("\n");
  const routedPads = fixture.nets.flatMap((net, index) =>
    net.class === "ground"
      ? []
      : net.pins.map((pin) => {
          const mapping = fixture.mappings.find((candidate) => candidate.partId === pin.partId);
          const pinPad = mapping?.pinPads.find((candidate) => candidate.pin === pin.pin);
          if (!pinPad) throw new KicadProjectionError(`missing pad for ${pin.partId}:${pin.pin}`);
          const [x, y] = padPosition(fixture, pin.partId, pinPad.pad);
          return `  (via (at ${x} ${y}) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net ${index + 1}))`;
        }),
  );
  const tracks = fixture.nets
    .flatMap((net, index) => {
      const points = net.pins.map((pin) => {
        const mapping = fixture.mappings.find((candidate) => candidate.partId === pin.partId);
        const pinPad = mapping?.pinPads.find((candidate) => candidate.pin === pin.pin);
        if (!pinPad) throw new KicadProjectionError(`missing pad for ${pin.partId}:${pin.pin}`);
        return padPosition(fixture, pin.partId, pinPad.pad);
      });
      const routedPoints =
        net.class === "ground"
          ? (() => {
              const width = fixture.requirement.board.widthMm;
              const height = fixture.requirement.board.heightMm;
              const detour: [number, number][] = [
                [2, height - 2],
                [width - 2, height - 2],
              ];
              if (width <= 4 || height <= 4) {
                throw new KicadProjectionError("ground detour does not fit board outline");
              }
              return [points[0], ...detour, ...points.slice(1)];
            })()
          : points;
      return routedPoints.slice(1).map((end, pointIndex) => {
        if (!end) throw new KicadProjectionError(`missing route endpoint for ${net.id}`);
        const [x, y] = end;
        const start = routedPoints[pointIndex];
        if (!start) throw new KicadProjectionError(`missing route point for ${net.id}`);
        const [startX, startY] = start;
        const layer = net.class === "ground" ? "F.Cu" : "B.Cu";
        return `  (segment (start ${startX} ${startY}) (end ${x} ${y}) (width 0.25) (layer "${layer}") (net ${index + 1}))`;
      });
    })
    .join("\n");
  return `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "b.silkscreen")
    (37 "F.SilkS" user "f.silkscreen")
    (44 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
${netLines.join("\n")}
  (gr_rect
    (start 0 0)
    (end ${fixture.requirement.board.widthMm} ${fixture.requirement.board.heightMm})
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )
${footprints}
${routedPads.join("\n")}
${tracks}
)`;
};

export const renderSchematic = (fixture: Phase1Fixture): string => {
  if (fixture.fixtureKind !== "smoke") {
    throw new KicadProjectionError(
      `Phase 1 schematic projection currently supports fixtureKind=smoke, received ${fixture.fixtureKind}`,
    );
  }
  const part = new Map(fixture.parts.map((item) => [item.id, item]));
  const mapping = new Map(fixture.mappings.map((item) => [item.partId, item]));
  const symbolPositions: Record<string, [number, number]> = {
    "part:j1": [106.68, 76.2],
    "part:r1": [127, 76.2],
    "part:d1": [152.4, 76.2],
    "part:c1": [127, 101.6],
  };
  const symbols = fixture.placementConstraints.components.map((placement, index) => {
    const currentPart = part.get(placement.partId);
    const currentMapping = mapping.get(placement.partId);
    if (!currentPart || !currentMapping) throw new Error(`missing mapping for ${placement.partId}`);
    const position = symbolPositions[placement.partId];
    if (!position)
      throw new KicadProjectionError(`unsupported schematic geometry for ${placement.partId}`);
    return renderSymbolInstance({
      libraryId: `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
      reference: currentPart.reference,
      value: currentPart.mpn,
      description: "Phase 1 smoke fixture symbol",
      footprint: `${currentMapping.footprintLibraryId}:${currentMapping.footprintName}`,
      x: position[0],
      y: position[1],
      pins: currentMapping.pinPads.map((pin) => pin.pin),
      symbolUuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      instancePath: `/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    });
  });
  const flags = [
    renderSymbolInstance({
      libraryId: "power:PWR_FLAG",
      reference: "#FLG01",
      value: "PWR_FLAG",
      description: "Phase 1 smoke fixture symbol",
      footprint: "",
      x: 114.3,
      y: 88.9,
      pins: ["1"],
      symbolUuid: "00000000-0000-4000-8000-000000000101",
      instancePath: "/00000000-0000-4000-8000-000000000101",
    }),
    renderSymbolInstance({
      libraryId: "power:PWR_FLAG",
      reference: "#FLG02",
      value: "PWR_FLAG",
      description: "Phase 1 smoke fixture symbol",
      footprint: "",
      x: 114.3,
      y: 114.3,
      pins: ["1"],
      symbolUuid: "00000000-0000-4000-8000-000000000102",
      instancePath: "/00000000-0000-4000-8000-000000000102",
    }),
  ];
  const labels = [
    renderLabel("+5V", 101.6, 76.2, "00000000-0000-4000-8000-000000001001"),
    renderLabel("+5V", 127, 72.39, "00000000-0000-4000-8000-000000001002"),
    renderLabel("+5V", 127, 97.79, "00000000-0000-4000-8000-000000001003"),
    renderLabel("GND", 101.6, 78.74, "00000000-0000-4000-8000-000000001004"),
    renderLabel("GND", 148.59, 76.2, "00000000-0000-4000-8000-000000001005"),
    renderLabel("GND", 127, 105.41, "00000000-0000-4000-8000-000000001006"),
    renderLabel("LED_A", 127, 80.01, "00000000-0000-4000-8000-000000001007"),
    renderLabel("LED_A", 156.21, 76.2, "00000000-0000-4000-8000-000000001008"),
    renderLabel("+5V", 114.3, 88.9, "00000000-0000-4000-8000-000000001009"),
    renderLabel("GND", 114.3, 114.3, "00000000-0000-4000-8000-000000001010"),
  ];
  return `(kicad_sch
	(version 20250114)
	(generator "eeschema")
	(generator_version "10.0")
	(uuid "${uuid}")
	(paper "A4")
	(lib_symbols
${smokeLibrarySymbols}
	)
${symbols.concat(flags).join("\n")}
${labels.join("\n")}
	(sheet_instances
		(path "/" (page "1"))
	)
)`;
};

export type KicadProjection = {
  directory: string;
  projectPath: string;
  schematicPath: string;
  boardPath: string;
};

export const projectToKicad = async (
  graph: DesignGraph | Phase1Fixture,
  directory: string,
): Promise<KicadProjection> => {
  if (!isPhase1Fixture(graph)) {
    const projection = await projectGraphToKicad(graph, directory);
    return {
      directory,
      projectPath: projection.projectPath,
      schematicPath: projection.schematicPath,
      boardPath: projection.boardPath,
    };
  }
  await mkdir(directory, { recursive: true });
  const projectPath = join(directory, "design.kicad_pro");
  const schematicPath = join(directory, "design.kicad_sch");
  const boardPath = join(directory, "design.kicad_pcb");
  await writeFile(projectPath, renderProject(), "utf8");
  await writeFile(join(directory, "fp-lib-table"), renderFootprintLibraryTable(), "utf8");
  await writeFile(join(directory, "sym-lib-table"), renderSymbolLibraryTable(), "utf8");
  await writeFile(schematicPath, renderSchematic(graph), "utf8");
  await writeFile(boardPath, renderSmokeBoard(graph), "utf8");
  return { directory, projectPath, schematicPath, boardPath };
};
