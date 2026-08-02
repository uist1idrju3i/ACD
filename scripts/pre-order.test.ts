import { describe, expect, it } from "vitest";
import { evaluatePreOrderReadiness } from "./pre-order.js";

const base = () => ({
  bom: [
    {
      partId: "part:r1",
      quantity: 1,
      mpn: "R",
      manufacturer: "M",
      supplier: "S",
      sku: "SKU",
      availability: "in-stock",
      lifecycle: "active",
      unitPrice: 1,
      currency: "USD",
    },
  ],
  budgetCap: 10,
  fabQuote: { unitPrice: 2, currency: "USD" },
  artifactManifest: { pcb: "sha256:" + "a".repeat(64) },
  unresolvedUnknowns: [],
});

describe("pre-order readiness", () => {
  it("passes complete BOM within budget", () => {
    expect(evaluatePreOrderReadiness(base()).ready).toBe(true);
  });
  it("fails missing SKU", () => {
    const input = base();
    delete input.bom[0].sku;
    expect(evaluatePreOrderReadiness(input).ready).toBe(false);
  });
  it("fails over budget", () => {
    const input = base();
    input.budgetCap = 1;
    expect(evaluatePreOrderReadiness(input).ready).toBe(false);
  });
  it("fails EOL parts", () => {
    const input = base();
    input.bom[0].lifecycle = "eol";
    expect(evaluatePreOrderReadiness(input).ready).toBe(false);
  });
});
