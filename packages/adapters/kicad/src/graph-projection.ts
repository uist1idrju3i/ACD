import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GraphCoreError,
  padPositionMm,
  readBoardModel,
  type BoardComponent,
  type BoardModel,
  type BoardPin,
  type DesignGraph,
} from "@acd/graph-core";
import {
  renderFootprintLibraryTable,
  renderProject,
  renderSymbolLibraryTable,
} from "./project-files.js";
import { deterministicUuid, renderLabel, renderSymbolInstance } from "./schematic-elements.js";
import { smokeLibrarySymbols } from "./symbol-library.js";

const sheetUuid = "00000000-0000-4000-8000-000000000001";

const mm = (value: number): string => String(Number(value.toFixed(6)));

export const renderBoardRoutes = (
  tracks: BoardModel["tracks"],
  vias: BoardModel["vias"],
  netCode: (netId: string) => number,
): string => {
  const renderedVias = vias
    .map(
      (via) =>
        `  (via (at ${mm(via.atMm.xMm)} ${mm(via.atMm.yMm)}) (size ${mm(via.diameterMm)}) (drill ${mm(via.drillMm)}) (layers ${via.layers.map((layer) => `"${layer}"`).join(" ")}) (net ${netCode(via.netId)}))`,
    )
    .join("\n");
  const renderedTracks = tracks
    .map(
      (track) =>
        `  (segment (start ${mm(track.startMm.xMm)} ${mm(track.startMm.yMm)}) (end ${mm(track.endMm.xMm)} ${mm(track.endMm.yMm)}) (width ${mm(track.widthMm)}) (layer "${track.layer}") (net ${netCode(track.netId)}))`,
    )
    .join("\n");
  return [renderedVias, renderedTracks].filter((value) => value.length > 0).join("\n");
};

const netOfPin = (model: BoardModel, pinId: string): { code: number; name: string } => {
  const net = model.nets.find((candidate) => candidate.pinIds.includes(pinId));
  if (!net) throw new GraphCoreError("reference-integrity", `pin has no net: ${pinId}`);
  return { code: net.code, name: net.name };
};

const footprintOf = (model: BoardModel, component: BoardComponent) => {
  const footprint = component.footprintId ? model.footprints.get(component.footprintId) : undefined;
  if (!footprint) {
    throw new GraphCoreError("reference-integrity", `component has no footprint: ${component.id}`);
  }
  return footprint;
};

const padLayers = (placementLayer: string): string => {
  if (placementLayer === "F.Cu") return `"F.Cu" "F.Paste" "F.Mask"`;
  if (placementLayer === "B.Cu") return `"B.Cu" "B.Paste" "B.Mask"`;
  throw new GraphCoreError(
    "verification-failed",
    `unsupported placement layer for SMD pads: ${placementLayer}`,
  );
};

const renderFootprint = (model: BoardModel, component: BoardComponent): string => {
  const placement = model.placements.find((candidate) => candidate.componentId === component.id);
  if (!placement) {
    throw new GraphCoreError("reference-integrity", `component has no placement: ${component.id}`);
  }
  const layers = padLayers(placement.layer);
  const footprint = footprintOf(model, component);
  const pads = component.pins
    .map((pin) => {
      const pad = footprint.pads.find((candidate) => candidate.number === pin.padNumber);
      if (!pad) {
        throw new GraphCoreError("reference-integrity", `pin has no pad geometry: ${pin.id}`);
      }
      const net = netOfPin(model, pin.id);
      return `    (pad "${pad.number}" smd roundrect (at ${mm(pad.xMm)} ${mm(pad.yMm)}) (size ${mm(pad.widthMm)} ${mm(pad.heightMm)}) (layers ${layers}) (roundrect_rratio 0.2) (net ${net.code} "${net.name}"))`;
    })
    .join("\n");
  return `  (footprint "${footprint.name}"
    (layer "${placement.layer}")
    (at ${mm(placement.xMm)} ${mm(placement.yMm)} ${mm(placement.rotationDeg)})
    (property "Reference" "${component.reference}" (at 0 -1.8 ${mm(placement.rotationDeg)}) (layer "F.Fab") hide)
    (property "Value" "${component.value}" (at 0 1.8 ${mm(placement.rotationDeg)}) (layer "F.Fab") hide)
${pads}
  )`;
};

export const renderGraphBoard = (model: BoardModel): string => {
  const nets = model.nets.map((net) => `  (net ${net.code} "${net.name}")`).join("\n");
  const footprints = model.placements
    .map((placement) => {
      const component = model.components.find(
        (candidate) => candidate.id === placement.componentId,
      );
      if (!component) {
        throw new GraphCoreError(
          "reference-integrity",
          `placement references an unknown component: ${placement.componentId}`,
        );
      }
      return renderFootprint(model, component);
    })
    .join("\n");
  const netCode = (netId: string): number => {
    const net = model.nets.find((candidate) => candidate.id === netId);
    if (!net) throw new GraphCoreError("reference-integrity", `unknown net: ${netId}`);
    return net.code;
  };
  const routes = renderBoardRoutes(model.tracks, model.vias, netCode);
  const { originMm, widthMm, heightMm } = model.outline;
  return `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (general (thickness ${mm(model.stackup.thicknessMm)}))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "b.silkscreen")
    (37 "F.SilkS" user "f.silkscreen")
    (44 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
${nets}
  (gr_rect
    (start ${mm(originMm.xMm)} ${mm(originMm.yMm)})
    (end ${mm(originMm.xMm + widthMm)} ${mm(originMm.yMm + heightMm)})
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )
${footprints}
${routes}
)`;
};

const pinLabelPosition = (
  component: BoardComponent,
  pin: BoardPin,
): { xMm: number; yMm: number } => ({
  xMm: component.schematic.xMm + pin.symbolOffsetMm.xMm,
  yMm: component.schematic.yMm - pin.symbolOffsetMm.yMm,
});

export const renderGraphSchematic = (model: BoardModel): string => {
  const symbols = model.components.map((component, index) => {
    if (component.schematic.rotationDeg !== 0) {
      throw new GraphCoreError(
        "verification-failed",
        `rotated schematic symbols are not projected: ${component.id}`,
      );
    }
    const footprint =
      component.role === "device"
        ? `${footprintOf(model, component).libraryId}:${footprintOf(model, component).name}`
        : "";
    return renderSymbolInstance({
      libraryId: `${component.symbol.libraryId}:${component.symbol.name}`,
      reference: component.reference,
      value: component.value,
      footprint,
      description: component.reference,
      x: component.schematic.xMm,
      y: component.schematic.yMm,
      pins: component.pins.map((pin) => pin.number),
      symbolUuid: deterministicUuid("", index + 1),
      instancePath: `/${deterministicUuid("", index + 1)}`,
    });
  });
  const labels = model.components.flatMap((component, componentIndex) =>
    component.pins.map((pin, pinIndex) => {
      const net = netOfPin(model, pin.id);
      const position = pinLabelPosition(component, pin);
      return renderLabel(
        net.name,
        position.xMm,
        position.yMm,
        deterministicUuid("1", (componentIndex + 1) * 100 + pinIndex + 1),
      );
    }),
  );
  return `(kicad_sch
	(version 20250114)
	(generator "eeschema")
	(generator_version "10.0")
	(uuid "${sheetUuid}")
	(paper "A4")
	(lib_symbols
${smokeLibrarySymbols}
	)
${symbols.join("\n")}
${labels.join("\n")}
	(sheet_instances
		(path "/" (page "1"))
	)
)`;
};

export type GraphNetlistPin = { net: string; reference: string; pin: string };

export const canonicalGraphNetlist = (model: BoardModel): GraphNetlistPin[] =>
  model.components
    .filter((component) => component.role === "device")
    .flatMap((component) =>
      component.pins.map((pin) => ({
        net: netOfPin(model, pin.id).name,
        reference: component.reference,
        pin: pin.number,
      })),
    )
    .sort((left, right) =>
      `${left.net}:${left.reference}-${left.pin}` < `${right.net}:${right.reference}-${right.pin}`
        ? -1
        : 1,
    );

export const canonicalGraphPcbNetlist = (model: BoardModel): GraphNetlistPin[] =>
  model.components
    .filter((component) => component.role === "device")
    .flatMap((component) =>
      component.pins.map((pin) => {
        if (!pin.padNumber) {
          throw new GraphCoreError("reference-integrity", `device pin has no pad: ${pin.id}`);
        }
        return {
          net: netOfPin(model, pin.id).name,
          reference: component.reference,
          pin: pin.padNumber,
        };
      }),
    )
    .sort((left, right) =>
      `${left.net}:${left.reference}-${left.pin}` < `${right.net}:${right.reference}-${right.pin}`
        ? -1
        : 1,
    );

export const boardPadPositions = (
  model: BoardModel,
): { pinId: string; xMm: number; yMm: number }[] =>
  model.components
    .filter((component) => component.role === "device")
    .flatMap((component) =>
      component.pins.map((pin) => {
        const position = padPositionMm(model, pin);
        return { pinId: pin.id, xMm: position.xMm, yMm: position.yMm };
      }),
    );

export type GraphProjection = {
  directory: string;
  projectPath: string;
  schematicPath: string;
  boardPath: string;
  model: BoardModel;
};

export const projectGraphToKicad = async (
  graph: DesignGraph,
  directory: string,
): Promise<GraphProjection> => {
  const model = readBoardModel(graph);
  await mkdir(directory, { recursive: true });
  const projectPath = join(directory, "design.kicad_pro");
  const schematicPath = join(directory, "design.kicad_sch");
  const boardPath = join(directory, "design.kicad_pcb");
  await writeFile(projectPath, renderProject(), "utf8");
  await writeFile(join(directory, "fp-lib-table"), renderFootprintLibraryTable(), "utf8");
  await writeFile(join(directory, "sym-lib-table"), renderSymbolLibraryTable(), "utf8");
  await writeFile(schematicPath, renderGraphSchematic(model), "utf8");
  await writeFile(boardPath, renderGraphBoard(model), "utf8");
  return { directory, projectPath, schematicPath, boardPath, model };
};
