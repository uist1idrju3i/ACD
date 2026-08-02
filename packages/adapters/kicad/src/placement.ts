import type { Phase1Fixture } from "@acd/schema";
import { parseFootprintCourtyard, parseFootprintPads, type FootprintBounds } from "./library.js";
import { KicadProjectionError } from "./errors.js";

export type FixturePlacement = Phase1Fixture["placementConstraints"]["components"][number];

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const grid = 0.5;
const fallbackMargin = 0.5;
const interCourtyardGap = 0.5;
const boardEdgeClearance = 1;

const snap = (value: number): number => Math.round(value / grid) * grid;

const rotateBounds = (bounds: FootprintBounds, placement: FixturePlacement): Bounds => {
  const radians = (placement.rotationDeg * Math.PI) / 180;
  const corners: Array<[number, number]> = [
    [bounds.minX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
  ].map(
    ([x, y]) =>
      [
        placement.xMm + x! * Math.cos(radians) + y! * Math.sin(radians),
        placement.yMm - x! * Math.sin(radians) + y! * Math.cos(radians),
      ] as [number, number],
  );
  return {
    minX: Math.min(...corners.map(([x]) => x)),
    maxX: Math.max(...corners.map(([x]) => x)),
    minY: Math.min(...corners.map(([, y]) => y)),
    maxY: Math.max(...corners.map(([, y]) => y)),
  };
};

const rotatedRegions = (bounds: FootprintBounds, placement: FixturePlacement): Bounds[] => {
  const regions = bounds.regions ?? [
    { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY },
  ];
  return regions.map((region) => rotateBounds({ ...region, source: bounds.source }, placement));
};

const boundsFor = (fixture: Phase1Fixture, placement: FixturePlacement): Bounds => {
  const mapping = fixture.mappings.find((candidate) => candidate.partId === placement.partId);
  if (!mapping) throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
  const courtyard = parseFootprintCourtyard(mapping.footprintName);
  const bounds =
    courtyard ??
    (() => {
      const pads = parseFootprintPads(mapping.footprintName);
      return {
        minX: Math.min(...pads.map((pad) => pad.x - pad.width / 2)) - fallbackMargin,
        maxX: Math.max(...pads.map((pad) => pad.x + pad.width / 2)) + fallbackMargin,
        minY: Math.min(...pads.map((pad) => pad.y - pad.height / 2)) - fallbackMargin,
        maxY: Math.max(...pads.map((pad) => pad.y + pad.height / 2)) + fallbackMargin,
        source: "pad-bbox-fallback" as const,
      };
    })();
  const rotated = rotateBounds(bounds, placement);
  if (![rotated.minX, rotated.maxX, rotated.minY, rotated.maxY].every(Number.isFinite)) {
    throw new KicadProjectionError(`invalid bounds for ${placement.partId}`);
  }
  return rotated;
};

const padBoundsFor = (fixture: Phase1Fixture, placement: FixturePlacement): Bounds => {
  const mapping = fixture.mappings.find((candidate) => candidate.partId === placement.partId);
  if (!mapping) throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
  const pads = parseFootprintPads(mapping.footprintName);
  return rotateBounds(
    {
      minX: Math.min(...pads.map((pad) => pad.x - pad.width / 2)),
      maxX: Math.max(...pads.map((pad) => pad.x + pad.width / 2)),
      minY: Math.min(...pads.map((pad) => pad.y - pad.height / 2)),
      maxY: Math.max(...pads.map((pad) => pad.y + pad.height / 2)),
      source: "pad-bbox-fallback",
    },
    placement,
  );
};

const clipToBoard = (bounds: Bounds, widthMm: number, heightMm: number): Bounds | undefined => {
  const clipped = {
    minX: Math.max(bounds.minX, 0),
    maxX: Math.min(bounds.maxX, widthMm),
    minY: Math.max(bounds.minY, 0),
    maxY: Math.min(bounds.maxY, heightMm),
  };
  return clipped.minX < clipped.maxX && clipped.minY < clipped.maxY ? clipped : undefined;
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
    const padBounds = padBoundsFor(fixture, placement);
    const { widthMm, heightMm } = fixture.requirement.board;
    if (
      padBounds.minX < boardEdgeClearance ||
      padBounds.minY < boardEdgeClearance ||
      padBounds.maxX > widthMm - boardEdgeClearance ||
      padBounds.maxY > heightMm - boardEdgeClearance
    ) {
      throw new KicadProjectionError(`placement does not fit board for ${placement.partId}`);
    }
    const mapping = fixture.mappings.find((candidate) => candidate.partId === placement.partId);
    if (!mapping) throw new KicadProjectionError(`missing mapping for ${placement.partId}`);
    const regions = rotatedRegions(
      parseFootprintCourtyard(mapping.footprintName) ?? {
        ...bounds,
        source: "pad-bbox-fallback",
      },
      placement,
    ).flatMap((region) => {
      const clipped = clipToBoard(region, widthMm, heightMm);
      return clipped ? [clipped] : [];
    });
    for (const existing of placed) {
      const existingMapping = fixture.mappings.find(
        (candidate) => candidate.partId === existing.placement.partId,
      );
      if (!existingMapping)
        throw new KicadProjectionError(`missing mapping for ${existing.placement.partId}`);
      const existingCourtyard = parseFootprintCourtyard(existingMapping.footprintName);
      const existingRegions = (
        existingCourtyard
          ? rotatedRegions(existingCourtyard, existing.placement)
          : [existing.bounds]
      ).flatMap((region) => {
        const clipped = clipToBoard(region, widthMm, heightMm);
        return clipped ? [clipped] : [];
      });
      const separated = regions.every((region) =>
        existingRegions.every((existingRegion) => {
          const expanded = {
            minX: region.minX - interCourtyardGap / 2,
            maxX: region.maxX + interCourtyardGap / 2,
            minY: region.minY - interCourtyardGap / 2,
            maxY: region.maxY + interCourtyardGap / 2,
          };
          const existingExpanded = {
            minX: existingRegion.minX - interCourtyardGap / 2,
            maxX: existingRegion.maxX + interCourtyardGap / 2,
            minY: existingRegion.minY - interCourtyardGap / 2,
            maxY: existingRegion.maxY + interCourtyardGap / 2,
          };
          return !overlaps(expanded, existingExpanded);
        }),
      );
      if (!separated) {
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
