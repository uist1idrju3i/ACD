import { GraphCoreError } from "./errors.js";
import type { DesignGraph } from "./semantic.js";

export type PointMm = { xMm: number; yMm: number };

export type BoardPad = {
  number: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export type BoardFootprint = {
  id: string;
  libraryId: string;
  name: string;
  pads: BoardPad[];
};

export type BoardPin = {
  id: string;
  componentId: string;
  number: string;
  name: string | undefined;
  electricalType: string;
  padNumber: string | undefined;
  symbolOffsetMm: PointMm;
};

export type ComponentRole = "device" | "power-flag";

export type BoardComponent = {
  id: string;
  role: ComponentRole;
  reference: string;
  value: string;
  partId: string | undefined;
  footprintId: string | undefined;
  symbol: { libraryId: string; name: string };
  schematic: { xMm: number; yMm: number; rotationDeg: number };
  pins: BoardPin[];
};

export type BoardNet = {
  id: string;
  name: string;
  netClass: string;
  code: number;
  pinIds: string[];
};

export type BoardPlacement = {
  componentId: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  layer: string;
};

export type BoardTrack = {
  netId: string;
  layer: string;
  widthMm: number;
  startMm: PointMm;
  endMm: PointMm;
};

export type BoardVia = {
  netId: string;
  atMm: PointMm;
  diameterMm: number;
  drillMm: number;
  layers: string[];
};

export type BoardOutline = {
  originMm: PointMm;
  widthMm: number;
  heightMm: number;
};

export type BoardStackup = {
  id: string;
  layerCount: number;
  thicknessMm: number;
  copperLayers: string[];
};

export type BoardModel = {
  projectId: string;
  outline: BoardOutline;
  stackup: BoardStackup;
  components: BoardComponent[];
  footprints: Map<string, BoardFootprint>;
  pins: Map<string, BoardPin>;
  nets: BoardNet[];
  placements: BoardPlacement[];
  tracks: BoardTrack[];
  vias: BoardVia[];
};

type Entity = DesignGraph["entities"][number];
type JsonRecord = Record<string, unknown>;

const invalid = (message: string): never => {
  throw new GraphCoreError("schema-invalid", message);
};

const unresolved = (message: string): never => {
  throw new GraphCoreError("reference-integrity", message);
};

const record = (value: unknown, where: string): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${where} must be an object`);
  }
  return value as JsonRecord;
};

const list = (value: unknown, where: string): unknown[] =>
  Array.isArray(value) ? value : invalid(`${where} must be an array`);

const text = (value: unknown, where: string): string =>
  typeof value === "string" && value.length > 0 ? value : invalid(`${where} must be a string`);

const optionalText = (value: unknown, where: string): string | undefined =>
  value === undefined ? undefined : text(value, where);

const number = (value: unknown, where: string): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : invalid(`${where} must be a finite number`);

const point = (value: unknown, where: string): PointMm => {
  const source = record(value, where);
  return { xMm: number(source["xMm"], `${where}.xMm`), yMm: number(source["yMm"], `${where}.yMm`) };
};

const attributesOf = (entity: Entity): JsonRecord =>
  record(entity.attributes, `${entity.id}.attributes`);

const single = (entities: Entity[], type: Entity["type"]): Entity => {
  const matches = entities.filter((entity) => entity.type === type);
  const [first] = matches;
  if (!first || matches.length !== 1) {
    return invalid(`the Phase 0 board graph requires exactly one ${type} entity`);
  }
  return first;
};

const readFootprint = (entity: Entity): BoardFootprint => {
  const attributes = attributesOf(entity);
  const pads = list(attributes["pads"], `${entity.id}.attributes.pads`).map((pad, index) => {
    const where = `${entity.id}.attributes.pads[${index}]`;
    const source = record(pad, where);
    return {
      number: text(source["number"], `${where}.number`),
      xMm: number(source["xMm"], `${where}.xMm`),
      yMm: number(source["yMm"], `${where}.yMm`),
      widthMm: number(source["widthMm"], `${where}.widthMm`),
      heightMm: number(source["heightMm"], `${where}.heightMm`),
    };
  });
  if (pads.length === 0) invalid(`${entity.id} must define at least one pad`);
  return {
    id: entity.id,
    libraryId: text(attributes["libraryId"], `${entity.id}.attributes.libraryId`),
    name: text(attributes["name"], `${entity.id}.attributes.name`),
    pads,
  };
};

const readPin = (entity: Entity): BoardPin => {
  const attributes = attributesOf(entity);
  return {
    id: entity.id,
    componentId: text(attributes["componentId"], `${entity.id}.attributes.componentId`),
    number: text(attributes["number"], `${entity.id}.attributes.number`),
    name: optionalText(attributes["name"], `${entity.id}.attributes.name`),
    electricalType: text(attributes["electricalType"], `${entity.id}.attributes.electricalType`),
    padNumber: optionalText(attributes["padNumber"], `${entity.id}.attributes.padNumber`),
    symbolOffsetMm: point(attributes["symbolOffsetMm"], `${entity.id}.attributes.symbolOffsetMm`),
  };
};

const readRole = (value: unknown, where: string): ComponentRole => {
  const role = text(value, where);
  if (role !== "device" && role !== "power-flag") {
    return invalid(`${where} must be "device" or "power-flag"`);
  }
  return role;
};

const readComponent = (entity: Entity, pins: BoardPin[]): BoardComponent => {
  const attributes = attributesOf(entity);
  const symbol = record(attributes["symbol"], `${entity.id}.attributes.symbol`);
  const schematic = record(attributes["schematic"], `${entity.id}.attributes.schematic`);
  const role = readRole(attributes["role"], `${entity.id}.attributes.role`);
  const footprintId = optionalText(
    attributes["footprintId"],
    `${entity.id}.attributes.footprintId`,
  );
  if (role === "device" && !footprintId) {
    invalid(`${entity.id} has role "device" and therefore requires attributes.footprintId`);
  }
  return {
    id: entity.id,
    role,
    reference: text(attributes["reference"], `${entity.id}.attributes.reference`),
    value: text(attributes["value"], `${entity.id}.attributes.value`),
    partId: optionalText(attributes["partId"], `${entity.id}.attributes.partId`),
    footprintId,
    symbol: {
      libraryId: text(symbol["libraryId"], `${entity.id}.attributes.symbol.libraryId`),
      name: text(symbol["name"], `${entity.id}.attributes.symbol.name`),
    },
    schematic: {
      xMm: number(schematic["xMm"], `${entity.id}.attributes.schematic.xMm`),
      yMm: number(schematic["yMm"], `${entity.id}.attributes.schematic.yMm`),
      rotationDeg: number(
        schematic["rotationDeg"],
        `${entity.id}.attributes.schematic.rotationDeg`,
      ),
    },
    pins: pins.filter((pin) => pin.componentId === entity.id),
  };
};

const readNet = (entity: Entity, code: number): BoardNet => {
  const attributes = attributesOf(entity);
  const pinIds = list(attributes["pinIds"], `${entity.id}.attributes.pinIds`).map((pinId, index) =>
    text(pinId, `${entity.id}.attributes.pinIds[${index}]`),
  );
  if (pinIds.length < 2) invalid(`${entity.id} must connect at least two pins`);
  return {
    id: entity.id,
    name: text(attributes["netName"], `${entity.id}.attributes.netName`),
    netClass: text(attributes["netClass"], `${entity.id}.attributes.netClass`),
    code,
    pinIds,
  };
};

const readLayout = (
  entity: Entity,
): {
  stackupId: string;
  outline: BoardOutline;
  placements: BoardPlacement[];
  tracks: BoardTrack[];
  vias: BoardVia[];
} => {
  const attributes = attributesOf(entity);
  const outline = record(attributes["boardOutline"], `${entity.id}.attributes.boardOutline`);
  return {
    stackupId: text(attributes["stackupId"], `${entity.id}.attributes.stackupId`),
    outline: {
      originMm: point(outline["originMm"], `${entity.id}.attributes.boardOutline.originMm`),
      widthMm: number(outline["widthMm"], `${entity.id}.attributes.boardOutline.widthMm`),
      heightMm: number(outline["heightMm"], `${entity.id}.attributes.boardOutline.heightMm`),
    },
    placements: list(attributes["placements"], `${entity.id}.attributes.placements`).map(
      (placement, index) => {
        const where = `${entity.id}.attributes.placements[${index}]`;
        const source = record(placement, where);
        return {
          componentId: text(source["componentId"], `${where}.componentId`),
          xMm: number(source["xMm"], `${where}.xMm`),
          yMm: number(source["yMm"], `${where}.yMm`),
          rotationDeg: number(source["rotationDeg"], `${where}.rotationDeg`),
          layer: text(source["layer"], `${where}.layer`),
        };
      },
    ),
    tracks: list(attributes["tracks"], `${entity.id}.attributes.tracks`).map((track, index) => {
      const where = `${entity.id}.attributes.tracks[${index}]`;
      const source = record(track, where);
      return {
        netId: text(source["netId"], `${where}.netId`),
        layer: text(source["layer"], `${where}.layer`),
        widthMm: number(source["widthMm"], `${where}.widthMm`),
        startMm: point(source["startMm"], `${where}.startMm`),
        endMm: point(source["endMm"], `${where}.endMm`),
      };
    }),
    vias: list(attributes["vias"], `${entity.id}.attributes.vias`).map((via, index) => {
      const where = `${entity.id}.attributes.vias[${index}]`;
      const source = record(via, where);
      return {
        netId: text(source["netId"], `${where}.netId`),
        atMm: point(source["atMm"], `${where}.atMm`),
        diameterMm: number(source["diameterMm"], `${where}.diameterMm`),
        drillMm: number(source["drillMm"], `${where}.drillMm`),
        layers: list(source["layers"], `${where}.layers`).map((layer, layerIndex) =>
          text(layer, `${where}.layers[${layerIndex}]`),
        ),
      };
    }),
  };
};

const readStackup = (entity: Entity): BoardStackup => {
  const attributes = attributesOf(entity);
  return {
    id: entity.id,
    layerCount: number(attributes["layerCount"], `${entity.id}.attributes.layerCount`),
    thicknessMm: number(attributes["thicknessMm"], `${entity.id}.attributes.thicknessMm`),
    copperLayers: list(attributes["copperLayers"], `${entity.id}.attributes.copperLayers`).map(
      (layer, index) => text(layer, `${entity.id}.attributes.copperLayers[${index}]`),
    ),
  };
};

/**
 * Reads the Phase 0 board projection view of a design graph and enforces the
 * reference integrity that the JSON Schema cannot express.
 */
export const readBoardModel = (graph: DesignGraph): BoardModel => {
  const entities = graph.entities;
  const pins = entities.filter((entity) => entity.type === "Pin").map(readPin);
  const pinsById = new Map(pins.map((pin) => [pin.id, pin]));
  const footprints = new Map(
    entities
      .filter((entity) => entity.type === "Footprint")
      .map(readFootprint)
      .map((footprint) => [footprint.id, footprint]),
  );
  const components = entities
    .filter((entity) => entity.type === "Component")
    .map((entity) => readComponent(entity, pins));
  const componentsById = new Map(components.map((component) => [component.id, component]));
  const partIds = new Set(entities.filter((entity) => entity.type === "Part").map((e) => e.id));
  const nets = entities
    .filter((entity) => entity.type === "Net")
    .map((entity, index) => readNet(entity, index + 1));
  const layout = readLayout(single(entities, "Layout"));
  const stackup = readStackup(single(entities, "BoardStackup"));

  for (const pin of pins) {
    if (!componentsById.has(pin.componentId)) {
      unresolved(`pin references an unknown component: ${pin.id} -> ${pin.componentId}`);
    }
  }
  for (const component of components) {
    if (component.partId && !partIds.has(component.partId)) {
      unresolved(`component references an unknown part: ${component.id} -> ${component.partId}`);
    }
    if (component.footprintId && !footprints.has(component.footprintId)) {
      unresolved(
        `component references an unknown footprint: ${component.id} -> ${component.footprintId}`,
      );
    }
    if (component.pins.length === 0) {
      unresolved(`component has no pins: ${component.id}`);
    }
    const footprint = component.footprintId ? footprints.get(component.footprintId) : undefined;
    for (const pin of component.pins) {
      if (component.role === "device" && !pin.padNumber) {
        unresolved(`device pin has no pad mapping: ${pin.id}`);
      }
      if (footprint && pin.padNumber) {
        if (!footprint.pads.some((pad) => pad.number === pin.padNumber)) {
          unresolved(`pin maps to an unknown pad: ${pin.id} -> ${footprint.id}:${pin.padNumber}`);
        }
      }
    }
  }
  const netByPinId = new Map<string, string>();
  for (const net of nets) {
    for (const pinId of net.pinIds) {
      if (!pinsById.has(pinId)) unresolved(`net references an unknown pin: ${net.id} -> ${pinId}`);
      const owner = netByPinId.get(pinId);
      if (owner) unresolved(`pin belongs to more than one net: ${pinId} (${owner}, ${net.id})`);
      netByPinId.set(pinId, net.id);
    }
  }
  for (const pin of pins) {
    if (!netByPinId.has(pin.id)) unresolved(`pin is not connected to any net: ${pin.id}`);
  }
  const netIds = new Set(nets.map((net) => net.id));
  for (const track of layout.tracks) {
    if (!netIds.has(track.netId)) unresolved(`track references an unknown net: ${track.netId}`);
  }
  for (const via of layout.vias) {
    if (!netIds.has(via.netId)) unresolved(`via references an unknown net: ${via.netId}`);
  }
  if (layout.stackupId !== stackup.id) {
    unresolved(`layout references an unknown stackup: ${layout.stackupId}`);
  }
  const placedComponentIds = new Set(layout.placements.map((placement) => placement.componentId));
  for (const placement of layout.placements) {
    const component = componentsById.get(placement.componentId);
    if (!component) {
      unresolved(`placement references an unknown component: ${placement.componentId}`);
      continue;
    }
    if (component.role !== "device") {
      invalid(`only device components can be placed on the board: ${component.id}`);
    }
    if (!stackup.copperLayers.includes(placement.layer)) {
      invalid(`placement layer is not part of the stackup: ${placement.componentId}`);
    }
  }
  for (const component of components) {
    if (component.role === "device" && !placedComponentIds.has(component.id)) {
      unresolved(`device component has no placement: ${component.id}`);
    }
  }

  return {
    projectId: graph.project.id,
    outline: layout.outline,
    stackup,
    components,
    footprints,
    pins: pinsById,
    nets,
    placements: layout.placements,
    tracks: layout.tracks,
    vias: layout.vias,
  };
};

export const padPositionMm = (
  model: BoardModel,
  pin: BoardPin,
): { xMm: number; yMm: number; layer: string } => {
  const component = model.components.find((candidate) => candidate.id === pin.componentId);
  if (!component) return unresolved(`pin references an unknown component: ${pin.id}`);
  const placement = model.placements.find((candidate) => candidate.componentId === component.id);
  if (!placement) return unresolved(`component has no placement: ${component.id}`);
  const footprint = component.footprintId ? model.footprints.get(component.footprintId) : undefined;
  const pad = footprint?.pads.find((candidate) => candidate.number === pin.padNumber);
  if (!pad) return unresolved(`pin has no pad geometry: ${pin.id}`);
  const radians = (placement.rotationDeg * Math.PI) / 180;
  return {
    xMm: placement.xMm + pad.xMm * Math.cos(radians) + pad.yMm * Math.sin(radians),
    yMm: placement.yMm - pad.xMm * Math.sin(radians) + pad.yMm * Math.cos(radians),
    layer: placement.layer,
  };
};
