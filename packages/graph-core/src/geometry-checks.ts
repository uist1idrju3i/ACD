import type { BoardModel, PointMm } from "./board.js";
import type { FabProfileRules } from "./fab-profile-rules.js";

export type NmPoint = { xNm: number; yNm: number };
export type NmPolygon = { points: NmPoint[] };

export type GeometryCheckInput = {
  pads: Array<{
    id: string;
    polygon: NmPolygon;
    netId?: string;
    layer?: string;
    maskExpansionNm?: number;
  }>;
  courtyards: Array<{ componentId: string; polygon: NmPolygon; layer?: string }>;
  thresholds: {
    minimumCopperClearanceNm?: number;
    minimumMaskSliverNm?: number;
    minimumCourtyardClearanceNm?: number;
  };
};

export type GeometryFinding = {
  id: string;
  ruleId: "pad-clearance" | "mask-sliver" | "mask-fusion" | "courtyard-overlap";
  status: "violation";
  subjectIds: string[];
  measuredNm: number;
  thresholdNm: number;
};

export type GeometryCheckResult = {
  status: "passed" | "failed" | "unknown";
  reason?: "canonical-data-not-provided" | "pad-connectivity-not-provided";
  findings: GeometryFinding[];
};

export type GeometryCheckResults = {
  padClearance: GeometryCheckResult;
  maskSliver: GeometryCheckResult;
  courtyardOverlap: GeometryCheckResult;
};

const nm = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new Error("geometry values must be safe integers");
  return value;
};

const pointAt = (points: NmPoint[], index: number): NmPoint => {
  const point = points[index];
  if (!point) throw new Error("polygon must contain at least three points");
  return point;
};

export const quantizeNm = (valueMm: number): number => nm(Math.round(valueMm * 1_000_000));

const quantizePoint = (point: PointMm): NmPoint => ({
  xNm: quantizeNm(point.xMm),
  yNm: quantizeNm(point.yMm),
});

const rotate = (point: PointMm, xMm: number, yMm: number, rotationDeg: number): PointMm => {
  const radians = (rotationDeg * Math.PI) / 180;
  return {
    xMm: xMm + point.xMm * Math.cos(radians) + point.yMm * Math.sin(radians),
    yMm: yMm - point.xMm * Math.sin(radians) + point.yMm * Math.cos(radians),
  };
};

const rectangle = (
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  rotationDeg: number,
): NmPolygon => ({
  points: [
    { xMm: -widthMm / 2, yMm: -heightMm / 2 },
    { xMm: widthMm / 2, yMm: -heightMm / 2 },
    { xMm: widthMm / 2, yMm: heightMm / 2 },
    { xMm: -widthMm / 2, yMm: heightMm / 2 },
  ].map((point) => quantizePoint(rotate(point, xMm, yMm, rotationDeg))),
});

export const quantizeBoardGeometry = (
  model: BoardModel,
  profile?: FabProfileRules,
): GeometryCheckInput => {
  const placements = new Map(
    model.placements.map((placement) => [placement.componentId, placement]),
  );
  const pads: GeometryCheckInput["pads"] = [];
  const courtyards: GeometryCheckInput["courtyards"] = [];
  for (const component of model.components) {
    const placement = placements.get(component.id);
    const footprint = component.footprintId
      ? model.footprints.get(component.footprintId)
      : undefined;
    if (!placement || !footprint) continue;
    if (footprint.courtyard) {
      courtyards.push({
        componentId: component.id,
        layer: placement.layer,
        polygon: {
          points: footprint.courtyard.points.map((point) =>
            quantizePoint(rotate(point, placement.xMm, placement.yMm, placement.rotationDeg)),
          ),
        },
      });
    }
    for (const pad of footprint.pads) {
      const matchingPins = component.pins.filter((pin) => pin.padNumber === pad.number);
      const netIds = matchingPins
        .map((pin) => model.nets.find((net) => net.pinIds.includes(pin.id))?.id)
        .filter((netId): netId is string => netId !== undefined);
      const resolvedNetId =
        netIds.length === matchingPins.length && new Set(netIds).size === 1 ? netIds[0] : undefined;
      const origin = rotate(
        { xMm: pad.xMm, yMm: pad.yMm },
        placement.xMm,
        placement.yMm,
        placement.rotationDeg,
      );
      const polygon =
        pad.shape?.kind === "polygon"
          ? {
              points: pad.shape.points.map((point) =>
                quantizePoint(rotate(point, origin.xMm, origin.yMm, placement.rotationDeg)),
              ),
            }
          : rectangle(origin.xMm, origin.yMm, pad.widthMm, pad.heightMm, placement.rotationDeg);
      pads.push({
        id: `pad:${component.id}:${pad.number}`,
        ...(placement.layer ? { layer: placement.layer } : {}),
        ...(resolvedNetId === undefined ? {} : { netId: resolvedNetId }),
        polygon,
        ...(pad.maskExpansionMm === undefined
          ? {}
          : { maskExpansionNm: quantizeNm(pad.maskExpansionMm) }),
      });
    }
  }
  return { pads, courtyards, thresholds: profile?.geometryThresholdsNm ?? {} };
};

const cross = (a: NmPoint, b: NmPoint, c: NmPoint): bigint =>
  BigInt(b.xNm - a.xNm) * BigInt(c.yNm - a.yNm) - BigInt(b.yNm - a.yNm) * BigInt(c.xNm - a.xNm);

const between = (a: NmPoint, b: NmPoint, c: NmPoint): boolean =>
  Math.min(a.xNm, b.xNm) <= c.xNm &&
  c.xNm <= Math.max(a.xNm, b.xNm) &&
  Math.min(a.yNm, b.yNm) <= c.yNm &&
  c.yNm <= Math.max(a.yNm, b.yNm);

const segmentsIntersect = (a: NmPoint, b: NmPoint, c: NmPoint, d: NmPoint): boolean => {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    ((abC > 0n && abD < 0n) || (abC < 0n && abD > 0n)) &&
    ((cdA > 0n && cdB < 0n) || (cdA < 0n && cdB > 0n))
  )
    return true;
  return (
    (abC === 0n && between(a, b, c)) ||
    (abD === 0n && between(a, b, d)) ||
    (cdA === 0n && between(c, d, a)) ||
    (cdB === 0n && between(c, d, b))
  );
};

const inside = (point: NmPoint, polygon: NmPolygon): boolean => {
  let winding = false;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const a = pointAt(polygon.points, index);
    const b = pointAt(polygon.points, (index + 1) % polygon.points.length);
    if (a.yNm > point.yNm !== b.yNm > point.yNm) {
      const lhs = BigInt(point.xNm - a.xNm) * BigInt(b.yNm - a.yNm);
      const rhs = BigInt(b.xNm - a.xNm) * BigInt(point.yNm - a.yNm);
      if (b.yNm > a.yNm === lhs < rhs) winding = !winding;
    }
  }
  return winding;
};

const squaredDistance = (a: NmPoint, b: NmPoint): bigint => {
  const dx = BigInt(a.xNm - b.xNm);
  const dy = BigInt(a.yNm - b.yNm);
  return dx * dx + dy * dy;
};

const pointSegmentDistanceSquared = (point: NmPoint, a: NmPoint, b: NmPoint): bigint => {
  const dx = BigInt(b.xNm - a.xNm);
  const dy = BigInt(b.yNm - a.yNm);
  const px = BigInt(point.xNm - a.xNm);
  const py = BigInt(point.yNm - a.yNm);
  const length = dx * dx + dy * dy;
  if (length === 0n) return squaredDistance(point, a);
  const dot = px * dx + py * dy;
  if (dot <= 0n) return squaredDistance(point, a);
  if (dot >= length) return squaredDistance(point, b);
  const area = px * dy - py * dx;
  return (area * area) / length;
};

const polygonDistanceSquared = (a: NmPolygon, b: NmPolygon): bigint => {
  if (a.points.some((point) => inside(point, b)) || b.points.some((point) => inside(point, a))) {
    return 0n;
  }
  let best: bigint | undefined;
  for (let ai = 0; ai < a.points.length; ai += 1) {
    const a1 = pointAt(a.points, ai);
    const a2 = pointAt(a.points, (ai + 1) % a.points.length);
    for (let bi = 0; bi < b.points.length; bi += 1) {
      const b1 = pointAt(b.points, bi);
      const b2 = pointAt(b.points, (bi + 1) % b.points.length);
      if (segmentsIntersect(a1, a2, b1, b2)) return 0n;
      for (const point of [a1, a2]) {
        const candidate = pointSegmentDistanceSquared(point, b1, b2);
        if (best === undefined || candidate < best) best = candidate;
      }
      for (const point of [b1, b2]) {
        const candidate = pointSegmentDistanceSquared(point, a1, a2);
        if (best === undefined || candidate < best) best = candidate;
      }
    }
  }
  return best ?? 0n;
};

const expandPolygon = (polygon: NmPolygon, expansionNm: number): NmPolygon => {
  const xs = polygon.points.map((point) => point.xNm);
  const ys = polygon.points.map((point) => point.yNm);
  const left = Math.min(...xs) - expansionNm;
  const right = Math.max(...xs) + expansionNm;
  const top = Math.min(...ys) - expansionNm;
  const bottom = Math.max(...ys) + expansionNm;
  return {
    points: [
      { xNm: left, yNm: top },
      { xNm: right, yNm: top },
      { xNm: right, yNm: bottom },
      { xNm: left, yNm: bottom },
    ],
  };
};

const result = (
  threshold: number | undefined,
  available: boolean,
  ruleId: GeometryFinding["ruleId"],
  pairs: Array<{ ids: string[]; measured: bigint; findingRuleId?: GeometryFinding["ruleId"] }>,
  unknownReason: GeometryCheckResult["reason"] = "canonical-data-not-provided",
): GeometryCheckResult => {
  if (threshold === undefined || !available) {
    return { status: "unknown", reason: unknownReason, findings: [] };
  }
  const thresholdSquared = BigInt(threshold) * BigInt(threshold);
  const findings = pairs
    .filter((pair) => pair.measured < thresholdSquared)
    .map((pair) => {
      const subjectIds = [...pair.ids].sort();
      const canonicalRuleId = pair.findingRuleId ?? ruleId;
      return {
        id: `finding:${canonicalRuleId}:${subjectIds.join(":")}`,
        ruleId: canonicalRuleId,
        status: "violation" as const,
        subjectIds,
        measuredNm: integerSqrt(pair.measured),
        thresholdNm: threshold,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return { status: findings.length === 0 ? "passed" : "failed", findings };
};

const integerSqrt = (value: bigint): number => {
  if (value < 1n) return 0;
  let low = 1n;
  let high = BigInt(Number.MAX_SAFE_INTEGER);
  while (low <= high) {
    const middle = (low + high) / 2n;
    if (middle <= value / middle) low = middle + 1n;
    else high = middle - 1n;
  }
  return Number(high);
};

export const runGeometryChecks = (input: GeometryCheckInput): GeometryCheckResults => {
  const padPairs: Array<{ ids: string[]; measured: bigint }> = [];
  const maskPairs: Array<{
    ids: string[];
    measured: bigint;
    findingRuleId?: GeometryFinding["ruleId"];
  }> = [];
  let padConnectivityUnknown = false;
  let maskDataUnknown = false;
  for (let left = 0; left < input.pads.length; left += 1) {
    for (let right = left + 1; right < input.pads.length; right += 1) {
      const a = input.pads[left];
      const b = input.pads[right];
      if (!a || !b) throw new Error("pad pair is missing");
      if (
        a.netId === undefined ||
        a.layer === undefined ||
        b.netId === undefined ||
        b.layer === undefined
      ) {
        padConnectivityUnknown = true;
      } else if (a.layer === b.layer && a.netId !== b.netId) {
        const distance = polygonDistanceSquared(a.polygon, b.polygon);
        padPairs.push({ ids: [a.id, b.id], measured: distance });
      }
      if (a.layer === undefined || b.layer === undefined) {
        maskDataUnknown = true;
      } else if (
        a.layer === b.layer &&
        a.maskExpansionNm !== undefined &&
        b.maskExpansionNm !== undefined
      ) {
        const maskDistance = polygonDistanceSquared(
          expandPolygon(a.polygon, a.maskExpansionNm),
          expandPolygon(b.polygon, b.maskExpansionNm),
        );
        maskPairs.push({
          ids: [a.id, b.id],
          measured: maskDistance,
          ...(maskDistance === 0n ? { findingRuleId: "mask-fusion" } : {}),
        });
      } else if (a.layer === b.layer) {
        maskDataUnknown = true;
      }
    }
  }
  const courtyardPairs: Array<{ ids: string[]; measured: bigint }> = [];
  let courtyardLayerUnknown = false;
  for (let left = 0; left < input.courtyards.length; left += 1) {
    for (let right = left + 1; right < input.courtyards.length; right += 1) {
      const a = input.courtyards[left];
      const b = input.courtyards[right];
      if (!a || !b) throw new Error("courtyard pair is missing");
      if (a.layer === undefined || b.layer === undefined) {
        courtyardLayerUnknown = true;
        continue;
      }
      if (a.layer !== b.layer) continue;
      courtyardPairs.push({
        ids: [a.componentId, b.componentId],
        measured: polygonDistanceSquared(a.polygon, b.polygon),
      });
    }
  }
  if (input.pads.some((pad) => pad.maskExpansionNm === undefined)) maskDataUnknown = true;
  return {
    padClearance: result(
      input.thresholds.minimumCopperClearanceNm,
      input.pads.length > 1 && !padConnectivityUnknown,
      "pad-clearance",
      padPairs,
      padConnectivityUnknown ? "pad-connectivity-not-provided" : undefined,
    ),
    maskSliver: result(
      input.thresholds.minimumMaskSliverNm,
      input.pads.length > 1 && !maskDataUnknown,
      "mask-sliver",
      maskPairs,
    ),
    courtyardOverlap: result(
      input.thresholds.minimumCourtyardClearanceNm,
      input.courtyards.length > 1 && !courtyardLayerUnknown,
      "courtyard-overlap",
      courtyardPairs,
    ),
  };
};
