import { canonicalize, sha256 } from "./hash.js";
import type { EventEnvelope } from "./event-log.js";
import type { DesignGraph } from "./semantic.js";
import type { Snapshot } from "./repository.js";

export type DiffStatus = "passed" | "failed" | "blocked" | "stale" | "unknown" | "unverified";

export type EntityChange = {
  category:
    | "net"
    | "component"
    | "placement"
    | "verification"
    | "rationale"
    | "evidence"
    | "entity";
  identity: string;
  before: unknown;
  after: unknown;
  status: DiffStatus;
};

export type RevisionDiff = {
  fromRevision: number;
  toRevision: number;
  sourcePatchIds: string[];
  sourceEventIds: string[];
  changes: EntityChange[];
};

type Entity = DesignGraph["entities"][number];
type Attributes = Record<string, unknown>;

const statusOf = (value: unknown): DiffStatus => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unverified";
  const status = (value as { status?: unknown }).status;
  if (
    status === "passed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "stale" ||
    status === "unknown"
  ) {
    return status;
  }
  return "unverified";
};

const attrs = (entity: Entity): Attributes => {
  if (
    !entity.attributes ||
    typeof entity.attributes !== "object" ||
    Array.isArray(entity.attributes)
  ) {
    return {};
  }
  return entity.attributes as Attributes;
};

const entityCategory = (entity: Entity): EntityChange["category"] => {
  if (entity.type === "Net") return "net";
  if (entity.type === "Component") return "component";
  if (entity.type === "VerificationResult") return "verification";
  if (entity.type === "Evidence") return "evidence";
  if (entity.type === "Rationale") return "rationale";
  return "entity";
};

const entityMap = (graph: DesignGraph): Map<string, Entity> =>
  new Map(graph.entities.map((entity) => [entity.id, entity]));

const layoutPlacements = (graph: DesignGraph): Map<string, unknown> => {
  const layout = graph.entities.find((entity) => entity.type === "Layout");
  const placements = attrs(layout ?? ({} as Entity))["placements"];
  if (!Array.isArray(placements)) return new Map();
  return new Map(
    placements.flatMap((placement) => {
      if (!placement || typeof placement !== "object" || Array.isArray(placement)) return [];
      const componentId = (placement as { componentId?: unknown }).componentId;
      return typeof componentId === "string" ? [[componentId, placement] as const] : [];
    }),
  );
};

const changed = (before: unknown, after: unknown): boolean =>
  canonicalize(before) !== canonicalize(after);

const sortedChanges = (changes: EntityChange[]): EntityChange[] =>
  changes.sort((left, right) =>
    `${left.category}:${left.identity}`.localeCompare(`${right.category}:${right.identity}`),
  );

export const diffSnapshots = (
  from: Snapshot,
  to: Snapshot,
  source: { patches?: readonly { patchId: string }[]; events?: readonly EventEnvelope[] } = {},
): RevisionDiff => {
  const before = entityMap(from.graph);
  const after = entityMap(to.graph);
  const changes: EntityChange[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const previous = before.get(id);
    const current = after.get(id);
    if (!changed(previous, current)) continue;
    changes.push({
      category: current ? entityCategory(current) : previous ? entityCategory(previous) : "entity",
      identity: id,
      before: previous ?? null,
      after: current ?? null,
      status: statusOf(current ?? previous),
    });
  }
  const placementsBefore = layoutPlacements(from.graph);
  const placementsAfter = layoutPlacements(to.graph);
  const placementIds = new Set([...placementsBefore.keys(), ...placementsAfter.keys()]);
  for (const id of placementIds) {
    const previous = placementsBefore.get(id);
    const current = placementsAfter.get(id);
    if (!changed(previous, current)) continue;
    changes.push({
      category: "placement",
      identity: id,
      before: previous ?? null,
      after: current ?? null,
      status: "unverified",
    });
  }
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    sourcePatchIds: [...(source.patches ?? [])].map((patch) => patch.patchId).sort(),
    sourceEventIds: [...(source.events ?? [])]
      .filter((event) => event.type === "patch.accepted")
      .map((event) => event.eventId)
      .sort(),
    changes: sortedChanges(changes),
  };
};

export const stableGeometryKey = (value: unknown): string => `geometry:${sha256(value)}`;
