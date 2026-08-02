import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignGraph } from "@acd/graph-core";
import type { Phase1Fixture } from "@acd/schema";

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
      const [offsetX, offsetY] = padOffset(partId, pinPad.pad);
      return `    (pad "${pinPad.pad}" smd roundrect (at ${offsetX} ${offsetY}) (size 1.2 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.2) (net ${net.code} "${net.name}"))`;
    })
    .join("\n");
  return `  (footprint "${mapping.footprintLibraryId}:${mapping.footprintName}"
    (layer "F.Cu")
    (at ${x} ${y} ${rotation})
    (property "Reference" "${part.reference}" (at 0 -1.8 ${rotation}) (layer "F.SilkS"))
    (property "Value" "${part.mpn}" (at 0 1.8 ${rotation}) (layer "F.Fab") hide)
${pads}
  )`;
};

export const renderBoard = (): string => `(kicad_pcb
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
  (gr_rect
    (start 10 10)
    (end 30 30)
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )
)`;

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
)`;
};

export const renderSchematic = (): string => `(kicad_sch
  (version 20231120)
  (generator eeschema)
  (uuid ${uuid})
  (paper "A4")
  (lib_symbols)
  (sheet_instances
    (path "/" (page "1"))
  )
)`;

export const renderProject = (): string =>
  JSON.stringify(
    {
      board: {},
      boards: [],
      cvpcb: {},
      eeschema: {},
      libraries: {},
      meta: { filename: "design.kicad_pro", version: 1 },
      net_settings: {},
      pcbnew: {},
      schematics: [],
      text_variables: {},
    },
    null,
    2,
  );

export const renderFootprintLibraryTable = (): string => `(fp_lib_table
  (version 7)
  (lib (name "Connector_JST") (type "KiCad") (uri "/usr/share/kicad/footprints/Connector_JST.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Resistor_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Resistor_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "LED_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/LED_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Capacitor_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Capacitor_SMD.pretty") (options "") (descr "KiCad official footprint library"))
)`;

export const renderSymbolLibraryTable = (): string => `(sym_lib_table
  (version 7)
  (lib (name "Connector_Generic") (type "KiCad") (uri "/usr/share/kicad/symbols/Connector_Generic.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Device") (type "KiCad") (uri "/usr/share/kicad/symbols/Device.kicad_sym") (options "") (descr "KiCad official symbol library"))
)`;

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
  await mkdir(directory, { recursive: true });
  const projectPath = join(directory, "design.kicad_pro");
  const schematicPath = join(directory, "design.kicad_sch");
  const boardPath = join(directory, "design.kicad_pcb");
  if (!isPhase1Fixture(graph) && graph.project.type !== "Project") {
    throw new Error("graph project entity must have type Project");
  }
  await writeFile(projectPath, renderProject(), "utf8");
  if (isPhase1Fixture(graph)) {
    await writeFile(join(directory, "fp-lib-table"), renderFootprintLibraryTable(), "utf8");
    await writeFile(join(directory, "sym-lib-table"), renderSymbolLibraryTable(), "utf8");
  }
  await writeFile(schematicPath, renderSchematic(), "utf8");
  await writeFile(
    boardPath,
    isPhase1Fixture(graph) ? renderSmokeBoard(graph) : renderBoard(),
    "utf8",
  );
  return { directory, projectPath, schematicPath, boardPath };
};
