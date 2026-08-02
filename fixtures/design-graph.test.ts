import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import type { ValidateFunction } from "ajv/dist/2020.js";
import {
  GraphCoreError,
  readBoardModel,
  validateSemanticGraph,
  type DesignGraph,
} from "../packages/graph-core/src/index.js";
import { loadSchemaValidator } from "../packages/schema/src/index.js";

const loadGraph = async (): Promise<DesignGraph> =>
  JSON.parse(
    await readFile(new URL("./design-graphs/normal-2layer.json", import.meta.url), "utf8"),
  ) as DesignGraph;

type JsonRecord = Record<string, unknown>;

const attributesOf = (graph: DesignGraph, entityId: string): JsonRecord => {
  const entity = graph.entities.find((candidate) => candidate.id === entityId);
  if (!entity?.attributes) throw new Error(`missing attributes for ${entityId}`);
  return entity.attributes as JsonRecord;
};

describe("normal-2layer design graph fixture", () => {
  let validate: ValidateFunction;

  beforeAll(async () => {
    validate = await loadSchemaValidator("design-graph");
  });

  it("satisfies the JSON Schema and the semantic validator", async () => {
    const graph = await loadGraph();

    expect(validate(graph)).toBe(true);
    expect(() => validateSemanticGraph(graph, 0)).not.toThrow();
  });

  it("describes a routed two-layer board with electrical connectivity", async () => {
    const model = readBoardModel(await loadGraph());

    expect(model.stackup.layerCount).toBe(2);
    expect(model.outline).toEqual({ originMm: { xMm: 0, yMm: 0 }, widthMm: 20, heightMm: 15 });
    expect(model.components.filter((component) => component.role === "device")).toHaveLength(4);
    expect(model.nets.map((net) => net.name)).toEqual(["+5V", "LED_A", "GND"]);
    expect(model.placements).toHaveLength(4);
    expect(model.tracks.length).toBeGreaterThan(0);
    expect(model.vias.length).toBeGreaterThan(0);
  });

  it("stops when a pin references a pad that the footprint does not define", async () => {
    const graph = await loadGraph();
    attributesOf(graph, "pin:r1-2")["padNumber"] = "3";

    expect(() => readBoardModel(graph)).toThrowError(GraphCoreError);
  });

  it("stops when a pin belongs to more than one net", async () => {
    const graph = await loadGraph();
    const supply = attributesOf(graph, "net:vcc");
    supply["pinIds"] = [...(supply["pinIds"] as string[]), "pin:d1-1"];

    expect(() => readBoardModel(graph)).toThrowError(GraphCoreError);
  });

  it("stops when a placed device is removed from the layout", async () => {
    const graph = await loadGraph();
    const layout = attributesOf(graph, "layout:main");
    layout["placements"] = (layout["placements"] as JsonRecord[]).filter(
      (placement) => placement["componentId"] !== "component:d1",
    );

    expect(() => readBoardModel(graph)).toThrowError(GraphCoreError);
  });
});
