import { canonicalize } from "./hash.js";
import { readBoardModel, type BoardModel } from "./board.js";
import type { DesignGraph } from "./semantic.js";

export type ProjectionPointMm = { xMm: number; yMm: number };

export type ProjectionPad = {
  id: string;
  number: string;
  componentId: string;
  layer: string;
  positionMm: ProjectionPointMm;
  widthMm: number;
  heightMm: number;
  shape: "rectangle";
};

export type ProjectionTrack = {
  id: string;
  netId: string;
  layer: string;
  widthMm: number;
  startMm: ProjectionPointMm;
  endMm: ProjectionPointMm;
};

export type ProjectionVia = {
  id: string;
  netId: string;
  atMm: ProjectionPointMm;
  diameterMm: number;
  drillMm: number;
  layers: string[];
};

export type UnavailableGeometry = {
  status: "unavailable";
  reason: "canonical-data-not-provided";
};

export type ProjectionGeometry = {
  schemaVersion: "acd-projection-1";
  projectId: string;
  revision: number;
  unit: "mm";
  outline: {
    originMm: ProjectionPointMm;
    widthMm: number;
    heightMm: number;
  };
  pads: ProjectionPad[];
  tracks: ProjectionTrack[];
  vias: ProjectionVia[];
  courtyard: UnavailableGeometry;
  mask: UnavailableGeometry;
};

const pointKey = (point: ProjectionPointMm): string => canonicalize(point);

const geometryKey = (value: unknown): string => canonicalize(value);

const duplicateKeys = (values: readonly string[]): Set<string> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
};

const stableGeometryIds = (values: readonly unknown[], prefix: string): string[] => {
  const keys = values.map(geometryKey);
  const duplicates = duplicateKeys(keys);
  const ordinals = new Map<string, number>();
  return keys.map((key) => {
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    return `${prefix}:${key}${duplicates.has(key) ? `:${ordinal}` : ""}`;
  });
};

const boardPads = (model: BoardModel): ProjectionPad[] => {
  const values = model.components
    .filter((component) => component.role === "device")
    .flatMap((component) => {
      const placement = model.placements.find(
        (candidate) => candidate.componentId === component.id,
      );
      const footprint = component.footprintId
        ? model.footprints.get(component.footprintId)
        : undefined;
      if (!placement || !footprint) return [];
      return component.pins.flatMap((pin) => {
        const pad = footprint.pads.find((candidate) => candidate.number === pin.padNumber);
        if (!pad) return [];
        const radians = (placement.rotationDeg * Math.PI) / 180;
        return [
          {
            id: `pad:${footprint.id}:${pad.number}`,
            number: pad.number,
            componentId: component.id,
            layer: placement.layer,
            positionMm: {
              xMm: placement.xMm + pad.xMm * Math.cos(radians) + pad.yMm * Math.sin(radians),
              yMm: placement.yMm - pad.xMm * Math.sin(radians) + pad.yMm * Math.cos(radians),
            },
            widthMm: pad.widthMm,
            heightMm: pad.heightMm,
            shape: "rectangle" as const,
          },
        ];
      });
    });
  return values.sort((left, right) => left.id.localeCompare(right.id));
};

const boardTracks = (model: BoardModel): ProjectionTrack[] => {
  const values = model.tracks.map((track) => ({
    netId: track.netId,
    layer: track.layer,
    widthMm: track.widthMm,
    startMm: track.startMm,
    endMm: track.endMm,
  }));
  return values
    .map((track, index, all) => ({
      id: stableGeometryIds(all, "track")[index] ?? `track:${index}`,
      ...track,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const boardVias = (model: BoardModel): ProjectionVia[] => {
  const values = model.vias.map((via) => ({
    netId: via.netId,
    atMm: via.atMm,
    diameterMm: via.diameterMm,
    drillMm: via.drillMm,
    layers: [...via.layers].sort(),
  }));
  return values
    .map((via, index, all) => ({
      id: stableGeometryIds(all, "via")[index] ?? `via:${index}`,
      ...via,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const projectBoardGeometry = (
  graph: DesignGraph,
  revision: number,
  artifactIds: readonly string[] = [],
): ProjectionGeometry & { artifactIds: string[] } => {
  const model = readBoardModel(graph);
  return {
    schemaVersion: "acd-projection-1",
    projectId: model.projectId,
    revision,
    unit: "mm",
    artifactIds: [...artifactIds].sort(),
    outline: {
      originMm: model.outline.originMm,
      widthMm: model.outline.widthMm,
      heightMm: model.outline.heightMm,
    },
    pads: boardPads(model),
    tracks: boardTracks(model),
    vias: boardVias(model),
    courtyard: { status: "unavailable", reason: "canonical-data-not-provided" },
    mask: { status: "unavailable", reason: "canonical-data-not-provided" },
  };
};

export const projectionPointKey = pointKey;
