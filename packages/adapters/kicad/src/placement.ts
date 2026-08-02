import type { Phase1Fixture } from "@acd/schema";
import { parseFootprintPads } from "./library.js";
import { KicadProjectionError } from "./errors.js";

export type FixturePlacement = Phase1Fixture["placementConstraints"]["components"][number];

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const grid = 0.5;
const margin = 0.5;

const snap = (value: number): number => Math.round(value / grid) * grid;

const boundsFor = (fixture: Phase1Fixture, placement: FixturePlacement): Bounds => {
  const mapping = fixture.mappings.find((candidate) => candidate.partId === placement.partId);
  if (!mapping) throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
  const pads = parseFootprintPads(mapping.footprintName);
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const corners: Array<[number, number]> = pads.flatMap((pad) => {
    const halfX = pad.width / 2 + margin;
    const halfY = pad.height / 2 + margin;
    const localCorners: Array<[number, number]> = [
      [-halfX, -halfY],
      [-halfX, halfY],
      [halfX, -halfY],
      [halfX, halfY],
    ];
    return localCorners.map(
      ([x, y]) =>
        [
          placement.xMm + x * Math.cos(radians) + y * Math.sin(radians),
          placement.yMm - x * Math.sin(radians) + y * Math.cos(radians),
        ] as [number, number],
    );
  });
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    throw new KicadProjectionError(`invalid bounds for ${placement.partId}`);
  }
  return { minX, maxX, minY, maxY };
};

const overlaps = (left: Bounds, right: Bounds): boolean =>
  left.minX < right.maxX &&
  left.maxX > right.minX &&
  left.minY < right.maxY &&
  left.maxY > right.minY;

const priority = (fixture: Phase1Fixture, partId: string): number => {
  const part = fixture.parts.find((candidate) => candidate.id === partId);
  if (part?.kind === "module") return 0;
  if (part?.kind === "regulator" || part?.kind === "connector") return 1;
  if (part?.kind === "sensor") return 2;
  if (part?.kind === "capacitor") return 3;
  return 4;
};

export const placeFixture = (fixture: Phase1Fixture): FixturePlacement[] => {
  const placements = fixture.placementConstraints.components.map((placement) => ({
    ...placement,
    xMm: snap(placement.xMm),
    yMm: snap(placement.yMm),
  }));
  const ordered = [...placements].sort(
    (left, right) =>
      priority(fixture, left.partId) - priority(fixture, right.partId) ||
      left.partId.localeCompare(right.partId),
  );
  const placed: Array<{ placement: FixturePlacement; bounds: Bounds }> = [];
  for (const placement of ordered) {
    const bounds = boundsFor(fixture, placement);
    const { widthMm, heightMm } = fixture.requirement.board;
    if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > widthMm || bounds.maxY > heightMm) {
      throw new KicadProjectionError(`placement does not fit board for ${placement.partId}`);
    }
    for (const existing of placed) {
      if (overlaps(bounds, existing.bounds)) {
        throw new KicadProjectionError(
          `placement overlap between ${placement.partId} and ${existing.placement.partId}`,
        );
      }
    }
    placed.push({ placement, bounds });
  }
  return ordered;
};

export const placementBounds = (fixture: Phase1Fixture, placement: FixturePlacement): Bounds =>
  boundsFor(fixture, placement);
