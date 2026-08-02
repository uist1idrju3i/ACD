import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignGraph } from "@acd/graph-core";
import type { Phase1Fixture } from "@acd/schema";
import { projectGraphToKicad } from "./graph-projection.js";
import { parseFootprintPads, verifyLibrarySnapshot } from "./library.js";
import { snapshotFiles, snapshotManifest } from "./library-snapshot.js";
import {
  officialLibraryRevision,
  resolveLibraryRevision,
  snapshotManifestHash,
  type LibraryOverlayPatch,
} from "./library-patch.js";
import { goldenLibrarySymbols, smokeLibrarySymbols } from "./symbol-library.js";
import { KicadProjectionError } from "./errors.js";
import { placeFixture } from "./placement.js";
import {
  assertNoPinOverlap,
  labelJustification,
  renderSheetText,
  renderTitleBlock,
  schematicLayout,
  type SymbolExtent,
} from "./schematic-layout.js";

export { KicadProjectionError } from "./errors.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const schematicGrid = (value: number): number => Math.round(value / 1.27) * 1.27;

const isPhase1Fixture = (input: DesignGraph | Phase1Fixture): input is Phase1Fixture =>
  "fixtureKind" in input && "parts" in input && "mappings" in input;

const padGeometry = (
  fixture: Phase1Fixture,
  partId: string,
  pad: string,
): ReturnType<typeof parseFootprintPads>[number] => {
  const mapping = fixture.mappings.find((candidate) => candidate.partId === partId);
  if (!mapping) throw new KicadProjectionError(`missing mapping for ${partId}`);
  const geometry = parseFootprintPads(mapping.footprintName).find(
    (candidate) => candidate.number === pad,
  );
  if (!geometry) {
    throw new KicadProjectionError(
      `official footprint has no geometry for ${mapping.footprintName} pad ${pad}`,
    );
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
  allowUnconnected = false,
): string => {
  const part = fixture.parts.find((candidate) => candidate.id === partId);
  const mapping = fixture.mappings.find((candidate) => candidate.partId === partId);
  if (!part || !mapping) throw new Error(`missing Phase 1 mapping for ${partId}`);
  const pads = mapping.pinPads
    .map((pinPad) => {
      const net = netByPin.get(`${partId}:${pinPad.pin}`);
      if (!net && !allowUnconnected) {
        throw new Error(`unresolved net for ${partId} pin ${pinPad.pin}`);
      }
      const geometry = padGeometry(fixture, partId, pinPad.pad);
      const layers = geometry.layers.map((layer) => `"${layer}"`).join(" ");
      const drill = geometry.drill ? ` (drill ${geometry.drill})` : "";
      const netLine = net ? ` (net ${net.code} "${net.name}")` : "";
      const padRotation = geometry.rotation ? ` ${geometry.rotation}` : "";
      return `    (pad "${pinPad.pad}" ${geometry.type} ${geometry.shape} (at ${geometry.x} ${geometry.y}${padRotation}) (size ${geometry.width} ${geometry.height})${drill} (layers ${layers})${netLine})`;
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

const renderFixtureNets = (
  fixture: Phase1Fixture,
  netByPin: Map<string, { code: number; name: string }>,
): string[] =>
  fixture.nets.map((net, index) => {
    for (const pin of net.pins) {
      netByPin.set(`${pin.partId}:${pin.pin}`, { code: index + 1, name: net.name });
    }
    return `  (net ${index + 1} "${net.name}")`;
  });

const padPosition = (fixture: Phase1Fixture, partId: string, pad: string): [number, number] => {
  const placement = fixture.placementConstraints.components.find(
    (candidate) => candidate.partId === partId,
  );
  if (!placement) throw new KicadProjectionError(`missing placement for ${partId}`);
  const geometry = padGeometry(fixture, partId, pad);
  const [localX, localY] = [geometry.x, geometry.y];
  const radians = (placement.rotationDeg * Math.PI) / 180;
  return [
    placement.xMm + localX * Math.cos(radians) + localY * Math.sin(radians),
    placement.yMm - localX * Math.sin(radians) + localY * Math.cos(radians),
  ];
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
  verifyLibrarySnapshot();
  const netByPin = new Map<string, { code: number; name: string }>();
  const netLines = renderFixtureNets(fixture, netByPin);
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
          const geometry = padGeometry(fixture, pin.partId, pinPad.pad);
          if (geometry.type === "thru_hole") return "";
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
              const firstPoint = points[0];
              if (!firstPoint) throw new KicadProjectionError("ground net has no route points");
              const detour: [number, number][] = [
                [0.75, firstPoint[1]],
                [0.75, height - 2],
                [width - 2, height - 2],
              ];
              const firstDetour = detour[0];
              const lastDetour = detour[detour.length - 1];
              if (
                !firstDetour ||
                !lastDetour ||
                width <= 4 ||
                height <= 4 ||
                firstDetour[0] <= 0 ||
                lastDetour[0] >= width
              ) {
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

export const renderGoldenBoard = (fixture: Phase1Fixture): string => {
  if (fixture.fixtureKind !== "golden") {
    throw new KicadProjectionError(`expected golden fixture, received ${fixture.fixtureKind}`);
  }
  verifyLibrarySnapshot();
  const placements = placeFixture(fixture);
  const netByPin = new Map<string, { code: number; name: string }>();
  const netLines = renderFixtureNets(fixture, netByPin);
  const footprints = placements
    .map((placement) =>
      renderSmokeFootprint(
        fixture,
        placement.partId,
        placement.xMm,
        placement.yMm,
        placement.rotationDeg,
        netByPin,
        true,
      ),
    )
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
  (net_class "Default" ""
    (clearance 0.127)
    (trace_width 0.25)
    (via_dia 0.8)
    (via_drill 0.4))
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

const rootSymbol = ({
  libraryId,
  reference,
  value,
  footprint,
  x,
  y,
  pins,
  symbolUuid,
  instancePath,
}: {
  libraryId: string;
  reference: string;
  value: string;
  footprint: string;
  x: number;
  y: number;
  pins: string[];
  symbolUuid: string;
  instancePath: string;
}): string => {
  const pinLines = pins
    .map(
      (pin, index) =>
        `\t\t(pin "${pin}"\n\t\t\t(uuid "00000000-0000-0000-0000-${symbolUuid.slice(-10)}${String(index + 1).padStart(2, "0")}")\n\t\t)`,
    )
    .join("\n");
  return `\t(symbol
		(lib_id "${libraryId}")
		(at ${x} ${y} 0)
		(unit 1)
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(dnp no)
		(uuid "${symbolUuid}")
		(property "Reference" "${reference}"
			(at ${x} ${y - 5} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Value" "${value}"
			(at ${x} ${y + 5} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Footprint" "${footprint}"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Datasheet" "~"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Description" "Phase 1 smoke fixture symbol"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
${pinLines}
		(instances
			(project "design"
				(path "${instancePath}"
					(reference "${reference}")
					(unit 1)
				)
			)
		)
	)`;
};

const label = (
  name: string,
  x: number,
  y: number,
  id: string,
  justify: "left" | "right" = "left",
): string => `	(label "${name}"
		(at ${x} ${y} 0)
		(effects
			(font (size 1.27 1.27))
			(justify ${justify} bottom)
		)
		(uuid "${id}")
	)`;

const symbolPinPositions = (libraryId: string): Map<string, [number, number]> => {
  const entry = snapshotManifest.files.find(
    (candidate) => candidate.kind === "symbol" && candidate.id === libraryId,
  );
  if (!entry) throw new KicadProjectionError(`missing symbol snapshot ${libraryId}`);
  const source = snapshotFiles[entry.path as keyof typeof snapshotFiles];
  if (!source) throw new KicadProjectionError(`missing symbol source ${entry.path}`);
  const pins = new Map<string, [number, number]>();
  const pinPattern =
    /\(pin [\s\S]*?\(at (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)(?:\s+\S+)?\)[\s\S]*?\(name "([^"]*)"\s*[\s\S]*?\(number "([^"]+)"/g;
  for (const match of source.matchAll(pinPattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const name = match[3];
    const number = match[4];
    if (number && Number.isFinite(x) && Number.isFinite(y)) {
      if (name) pins.set(name, [x, y]);
      pins.set(number, [x, y]);
      if (number.startsWith("[") && number.endsWith("]")) {
        for (const alias of number.slice(1, -1).split(",")) {
          pins.set(alias.trim(), [x, y]);
        }
      }
    }
  }
  if (pins.size === 0 && libraryId === "Regulator_Linear:AMS1117-3.3") {
    pins.set("1", [0, -7.62]);
    pins.set("GND", [0, -7.62]);
    pins.set("2", [7.62, 0]);
    pins.set("VO", [7.62, 0]);
    pins.set("3", [-7.62, 0]);
    pins.set("VI", [-7.62, 0]);
  }
  return pins;
};

const renderGoldenSchematic = (fixture: Phase1Fixture): string => {
  const part = new Map(fixture.parts.map((item) => [item.id, item]));
  const mapping = new Map(fixture.mappings.map((item) => [item.partId, item]));
  const placements = placeFixture(fixture);
  const symbolExtent = (partId: string): SymbolExtent => {
    const currentMapping = mapping.get(partId);
    if (!currentMapping) throw new KicadProjectionError(`missing mapping for ${partId}`);
    const positions = symbolPinPositions(
      `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
    );
    // Sheet space: the renderer places a pin at (origin + x, origin - y).
    const points = currentMapping.pinPads
      .map((pinPad) => positions.get(pinPad.pin))
      .filter((position): position is [number, number] => position !== undefined)
      .map(([x, y]) => [x, -y] as [number, number]);
    if (points.length === 0) throw new KicadProjectionError(`no symbol pin geometry for ${partId}`);
    return {
      minXMm: Math.min(...points.map(([x]) => x)),
      maxXMm: Math.max(...points.map(([x]) => x)),
      minYMm: Math.min(...points.map(([, y]) => y)),
      maxYMm: Math.max(...points.map(([, y]) => y)),
    };
  };
  const layout = schematicLayout(fixture, symbolExtent);
  const schematicOrigins = layout.origins;
  const symbols = placements.map((placement, index) => {
    const currentPart = part.get(placement.partId);
    const currentMapping = mapping.get(placement.partId);
    if (!currentPart || !currentMapping) {
      throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
    }
    return rootSymbol({
      libraryId: `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
      reference: currentPart.reference,
      value: currentPart.mpn,
      footprint: `${currentMapping.footprintLibraryId}:${currentMapping.footprintName}`,
      x: schematicOrigins.get(placement.partId)![0],
      y: schematicOrigins.get(placement.partId)![1],
      pins: currentMapping.pinPads.map((pin) => pin.pin),
      symbolUuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      instancePath: `/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    });
  });
  const labels = fixture.nets.flatMap((net, netIndex) =>
    net.pins.flatMap((netPin, pinIndex) => {
      const currentPart = part.get(netPin.partId);
      const currentMapping = mapping.get(netPin.partId);
      const placement = placements.find((candidate) => candidate.partId === netPin.partId);
      if (!currentPart || !currentMapping || !placement) {
        throw new KicadProjectionError(`missing golden net placement for ${netPin.partId}`);
      }
      const positions = symbolPinPositions(
        `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
      );
      const position = positions.get(netPin.pin);
      if (!position) {
        throw new KicadProjectionError(
          `missing symbol pin position for ${currentPart.reference}:${netPin.pin}`,
        );
      }
      const [x, y] = position;
      const origin = schematicOrigins.get(placement.partId)!;
      const sx = origin[0] + x;
      const sy = origin[1] - y;
      return label(
        net.name,
        sx,
        sy,
        `00000000-0000-4000-8000-${String(netIndex * 100 + pinIndex + 1).padStart(12, "0")}`,
        labelJustification(x),
      );
    }),
  );
  const noConnects = placements.flatMap((placement, partIndex) => {
    const currentMapping = mapping.get(placement.partId);
    if (!currentMapping) throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
    const positions = symbolPinPositions(
      `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
    );
    return currentMapping.pinPads.flatMap((pinPad, pinIndex) => {
      const connected = fixture.nets.some((net) =>
        net.pins.some(
          (pin) =>
            pin.partId === placement.partId && (pin.pin === pinPad.pin || pin.pin === pinPad.pad),
        ),
      );
      if (connected) return [];
      const position = positions.get(pinPad.pin);
      if (!position) return [];
      const [x, y] = position;
      return `(no_connect
        (at ${schematicOrigins.get(placement.partId)![0] + x} ${schematicOrigins.get(placement.partId)![1] - y})
		(uuid "00000000-0000-4000-8000-${String(3000 + partIndex * 100 + pinIndex).padStart(12, "0")}")
	)`;
    });
  });
  const flagNets = ["+5V", "GND"];
  const flagPins: Array<[string, string]> = [
    ["part:u3", "3"],
    ["part:u1", "GND"],
  ];
  const flagCoordinates = flagPins.map((entry, index) => {
    if (!entry) return [schematicGrid(70 + index * 35), schematicGrid(35)] as [number, number];
    const [partId, pin] = entry;
    const currentMapping = mapping.get(partId);
    const position = currentMapping
      ? symbolPinPositions(`${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`).get(
          pin,
        )
      : undefined;
    const origin = schematicOrigins.get(partId);
    if (!position || !origin) {
      throw new KicadProjectionError(`missing power flag pin position for ${partId}:${pin}`);
    }
    return [origin[0] + position[0], origin[1] - position[1]] as [number, number];
  });
  const flags = flagNets.map((_, index) =>
    rootSymbol({
      libraryId: "power:PWR_FLAG",
      reference: `#FLG${String(index + 1).padStart(2, "0")}`,
      value: "PWR_FLAG",
      footprint: "",
      x: flagCoordinates[index]![0],
      y: flagCoordinates[index]![1],
      pins: ["1"],
      symbolUuid: `00000000-0000-4000-8000-00000000010${index + 1}`,
      instancePath: `/00000000-0000-4000-8000-00000000010${index + 1}`,
    }),
  );
  const blockAnnotations = layout.annotations.map((annotation, index) =>
    renderSheetText(
      annotation.text,
      annotation.xMm,
      annotation.yMm,
      // Disjoint band: symbols use 1-999, flags 101+, no-connects 3000+, labels 100*net.
      `00000000-0000-4000-8000-${String(800000 + index).padStart(12, "0")}`,
    ),
  );
  assertNoPinOverlap(
    placements.flatMap((placement) => {
      const currentMapping = mapping.get(placement.partId);
      const currentPart = part.get(placement.partId);
      if (!currentMapping || !currentPart) return [];
      const positions = symbolPinPositions(
        `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
      );
      const origin = schematicOrigins.get(placement.partId)!;
      return currentMapping.pinPads.flatMap((pinPad) => {
        const position = positions.get(pinPad.pin);
        if (!position) return [];
        return [
          {
            partId: placement.partId,
            entity: `${currentPart.reference}:${pinPad.pin}`,
            xMm: origin[0] + position[0],
            yMm: origin[1] - position[1],
          },
        ];
      });
    }),
  );
  const flagLabels = flagNets.map((netName, index) =>
    label(
      netName,
      flagCoordinates[index]![0],
      flagCoordinates[index]![1],
      `00000000-0000-4000-8000-00000000020${index + 1}`,
    ),
  );
  return `(kicad_sch
	(version 20250114)
	(generator "eeschema")
	(generator_version "10.0")
	(uuid "${uuid}")
	(paper "A4")
${renderTitleBlock(fixture)}
	(lib_symbols
${goldenLibrarySymbols}
	)
${blockAnnotations.join("\n")}
${symbols.concat(flags).join("\n")}
${labels.join("\n")}
${flagLabels.join("\n")}
${noConnects.join("\n")}
	(sheet_instances
		(path "/" (page "1"))
	)
)`;
};

export const renderSchematic = (fixture: Phase1Fixture): string => {
  if (fixture.fixtureKind === "golden") return renderGoldenSchematic(fixture);
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
    return rootSymbol({
      libraryId: `${currentMapping.symbolLibraryId}:${currentMapping.symbolName}`,
      reference: currentPart.reference,
      value: currentPart.mpn,
      footprint: `${currentMapping.footprintLibraryId}:${currentMapping.footprintName}`,
      x: position[0],
      y: position[1],
      pins: currentMapping.pinPads.map((pin) => pin.pin),
      symbolUuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      instancePath: `/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    });
  });
  const flags = [
    rootSymbol({
      libraryId: "power:PWR_FLAG",
      reference: "#FLG01",
      value: "PWR_FLAG",
      footprint: "",
      x: 114.3,
      y: 88.9,
      pins: ["1"],
      symbolUuid: "00000000-0000-4000-8000-000000000101",
      instancePath: "/00000000-0000-4000-8000-000000000101",
    }),
    rootSymbol({
      libraryId: "power:PWR_FLAG",
      reference: "#FLG02",
      value: "PWR_FLAG",
      footprint: "",
      x: 114.3,
      y: 114.3,
      pins: ["1"],
      symbolUuid: "00000000-0000-4000-8000-000000000102",
      instancePath: "/00000000-0000-4000-8000-000000000102",
    }),
  ];
  const labels = [
    label("+5V", 101.6, 76.2, "00000000-0000-4000-8000-000000001001"),
    label("+5V", 127, 72.39, "00000000-0000-4000-8000-000000001002"),
    label("+5V", 127, 97.79, "00000000-0000-4000-8000-000000001003"),
    label("GND", 101.6, 78.74, "00000000-0000-4000-8000-000000001004"),
    label("GND", 148.59, 76.2, "00000000-0000-4000-8000-000000001005"),
    label("GND", 127, 105.41, "00000000-0000-4000-8000-000000001006"),
    label("LED_A", 127, 80.01, "00000000-0000-4000-8000-000000001007"),
    label("LED_A", 156.21, 76.2, "00000000-0000-4000-8000-000000001008"),
    label("+5V", 114.3, 88.9, "00000000-0000-4000-8000-000000001009"),
    label("GND", 114.3, 114.3, "00000000-0000-4000-8000-000000001010"),
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
  (lib (name "Connector_USB") (type "KiCad") (uri "/usr/share/kicad/footprints/Connector_USB.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Package_LGA") (type "KiCad") (uri "/usr/share/kicad/footprints/Package_LGA.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Package_TO_SOT_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Package_TO_SOT_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Connector_PinHeader_2.54mm") (type "KiCad") (uri "/usr/share/kicad/footprints/Connector_PinHeader_2.54mm.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Button_Switch_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Button_Switch_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "RF_Module") (type "KiCad") (uri "/usr/share/kicad/footprints/RF_Module.pretty") (options "") (descr "KiCad official footprint library"))
)`;

export const renderSymbolLibraryTable = (): string => `(sym_lib_table
  (version 7)
  (lib (name "Connector_Generic") (type "KiCad") (uri "/usr/share/kicad/symbols/Connector_Generic.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Device") (type "KiCad") (uri "/usr/share/kicad/symbols/Device.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "power") (type "KiCad") (uri "/usr/share/kicad/symbols/power.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Connector") (type "KiCad") (uri "/usr/share/kicad/symbols/Connector.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Switch") (type "KiCad") (uri "/usr/share/kicad/symbols/Switch.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Regulator_Linear") (type "KiCad") (uri "/usr/share/kicad/symbols/Regulator_Linear.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "RF_Module") (type "KiCad") (uri "/usr/share/kicad/symbols/RF_Module.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Sensor") (type "KiCad") (uri "/usr/share/kicad/symbols/Sensor.kicad_sym") (options "") (descr "KiCad official symbol library"))
)`;

export type KicadProjection = {
  directory: string;
  projectPath: string;
  schematicPath: string;
  boardPath: string;
};

export type KicadProjectionOptions = {
  libraryRevision?: string;
  patches?: LibraryOverlayPatch[];
  allowUnadoptedForVerification?: boolean;
};

export const projectToKicad = async (
  graph: DesignGraph | Phase1Fixture,
  directory: string,
  options: KicadProjectionOptions = {},
): Promise<KicadProjection> => {
  const libraryRevision = options.libraryRevision ?? officialLibraryRevision();
  const patch = resolveLibraryRevision(
    libraryRevision,
    options.patches ?? [],
    options.allowUnadoptedForVerification ?? false,
  );
  if (!isPhase1Fixture(graph)) {
    const projection = await projectGraphToKicad(graph, directory);
    await writeFile(
      join(directory, "library-revision.json"),
      `${JSON.stringify(
        {
          libraryRevision,
          snapshotManifestHash: patch?.snapshotManifestHash ?? snapshotManifestHash(),
          overlayPatchId: patch?.id ?? null,
        },
        null,
        2,
      )}\n`,
    );
    if (patch) {
      await mkdir(join(directory, "library-overlays"), { recursive: true });
      await writeFile(
        join(directory, "library-overlays", `${patch.footprintId}.kicad_mod`),
        patch.content,
        "utf8",
      );
    }
    return {
      directory,
      projectPath: projection.projectPath,
      schematicPath: projection.schematicPath,
      boardPath: projection.boardPath,
    };
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "library-revision.json"),
    `${JSON.stringify(
      {
        libraryRevision,
        snapshotManifestHash: patch?.snapshotManifestHash ?? snapshotManifestHash(),
        overlayPatchId: patch?.id ?? null,
      },
      null,
      2,
    )}\n`,
  );
  if (patch) {
    await mkdir(join(directory, "library-overlays"), { recursive: true });
    await writeFile(
      join(directory, "library-overlays", `${patch.footprintId}.kicad_mod`),
      patch.content,
      "utf8",
    );
  }
  const projectPath = join(directory, "design.kicad_pro");
  const schematicPath = join(directory, "design.kicad_sch");
  const boardPath = join(directory, "design.kicad_pcb");
  await writeFile(projectPath, renderProject(), "utf8");
  if (isPhase1Fixture(graph)) {
    await writeFile(join(directory, "fp-lib-table"), renderFootprintLibraryTable(), "utf8");
    await writeFile(join(directory, "sym-lib-table"), renderSymbolLibraryTable(), "utf8");
  }
  await writeFile(schematicPath, renderSchematic(graph), "utf8");
  await writeFile(
    boardPath,
    graph.fixtureKind === "golden" ? renderGoldenBoard(graph) : renderSmokeBoard(graph),
    "utf8",
  );
  return { directory, projectPath, schematicPath, boardPath };
};
