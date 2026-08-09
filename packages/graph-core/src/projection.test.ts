import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectBoardGeometry } from "./projection.js";
import type { DesignGraph } from "./semantic.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../../fixtures/phase4/wp6-browser-run/graph.json",
);

describe("board projection pad identity", () => {
  it("keeps pads distinct when placed components share one footprint", async () => {
    const graph = JSON.parse(await readFile(fixturePath, "utf8")) as DesignGraph;
    const original = graph.entities.find(
      (entity) => entity.type === "Component" && entity.id === "component:r1",
    );
    if (!original || original.type !== "Component") throw new Error("fixture component missing");
    const clone = structuredClone(original);
    clone.id = "component:r2";
    const attributes = clone.attributes as Record<string, unknown>;
    attributes["reference"] = "R2";
    attributes["partId"] = "part:r1";
    const pins = graph.entities.filter(
      (entity) =>
        entity.type === "Pin" &&
        (entity.attributes as Record<string, unknown>)["componentId"] === original.id,
    );
    const clonedPins = pins.map((pin) => {
      const copy = structuredClone(pin);
      copy.id = copy.id.replace("pin:r1-", "pin:r2-");
      (copy.attributes as Record<string, unknown>)["componentId"] = clone.id;
      return copy;
    });
    clone.revision = 0;
    graph.entities.push(clone, ...clonedPins);
    const layout = graph.entities.find((entity) => entity.type === "Layout");
    if (!layout || layout.type !== "Layout") throw new Error("fixture layout missing");
    const layoutAttributes = layout.attributes as Record<string, unknown>;
    const placements = layoutAttributes["placements"] as Array<Record<string, unknown>>;
    placements.push({
      componentId: clone.id,
      xMm: 16,
      yMm: 10,
      rotationDeg: 0,
      layer: "F.Cu",
    });
    for (const net of graph.entities.filter((entity) => entity.type === "Net")) {
      const netAttributes = net.attributes as Record<string, unknown>;
      const pinIds = netAttributes["pinIds"] as string[];
      for (const pin of clonedPins) {
        const originalPinId = pin.id.replace("pin:r2-", "pin:r1-");
        if (pinIds.includes(originalPinId)) pinIds.push(pin.id);
      }
    }

    const projection = projectBoardGeometry(graph, 0);
    const clonePads = projection.pads.filter((pad) => pad.componentId === clone.id);
    expect(clonePads).toHaveLength(2);
    expect(new Set(projection.pads.map((pad) => pad.id)).size).toBe(projection.pads.length);
    expect(clonePads.map((pad) => pad.id).sort()).toEqual([
      "pad:component:r2:1",
      "pad:component:r2:2",
    ]);
  });
});
