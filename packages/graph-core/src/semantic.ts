import type { ACDDesignGraphPhase0Draft } from "@acd/schema";
import { GraphCoreError } from "./errors.js";

export type DesignGraph = ACDDesignGraphPhase0Draft;

export const validateSemanticGraph = (graph: DesignGraph, expectedRevision?: number): void => {
  const ids = new Set<string>();
  for (const entity of graph.entities) {
    if (ids.has(entity.id)) {
      throw new GraphCoreError(
        "reference-integrity",
        `duplicate entity id: ${entity.id}`,
        "error",
        {
          entityId: entity.id,
        },
      );
    }
    ids.add(entity.id);
    if (!Number.isInteger(entity.revision) || entity.revision < 0) {
      throw new GraphCoreError("revision-invalid", `invalid entity revision: ${entity.id}`);
    }
  }
  if (
    !ids.has(graph.project.id) ||
    graph.project.id !== graph.entities.find((e) => e.id === graph.project.id)?.id
  ) {
    throw new GraphCoreError(
      "reference-integrity",
      `project entity is not present: ${graph.project.id}`,
    );
  }
  for (const entity of graph.entities) {
    for (const link of entity.links ?? []) {
      if (!ids.has(link)) {
        throw new GraphCoreError(
          "reference-integrity",
          `unresolved entity link: ${entity.id} -> ${link}`,
          "error",
          {
            entityId: entity.id,
            link,
          },
        );
      }
    }
  }
  if (
    expectedRevision !== undefined &&
    graph.entities.some((entity) => entity.revision > expectedRevision)
  ) {
    throw new GraphCoreError(
      "revision-invalid",
      "entity revision exceeds snapshot revision",
      "error",
      {
        expectedRevision,
      },
    );
  }
};
