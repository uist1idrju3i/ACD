export type PreOrderInput = {
  bom: Array<{
    partId: string;
    quantity: number;
    mpn: string;
    manufacturer: string;
    supplier: string;
    sku?: string;
    availability: string;
    lifecycle?: string;
    unitPrice?: number;
    currency?: string;
  }>;
  budgetCap: number;
  fabQuote: { unitPrice: number; currency: string };
  artifactManifest: Record<string, string>;
  unresolvedUnknowns: string[];
};

export const evaluatePreOrderReadiness = (input: PreOrderInput) => {
  const missing = input.bom.flatMap((line) => {
    const fields = ["mpn", "manufacturer", "supplier", "sku"] as const;
    return fields.filter((field) => !line[field]).map((field) => `${line.partId}.${field}`);
  });
  const lifecycleIssues = input.bom
    .filter(
      (line) =>
        line.availability === "unknown" || line.lifecycle === "unknown" || line.lifecycle === "eol",
    )
    .map((line) => `${line.partId}.availability/lifecycle`);
  const components = input.bom.reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * line.quantity,
    0,
  );
  const total = components + input.fabQuote.unitPrice;
  const unknowns = [...missing, ...lifecycleIssues, ...input.unresolvedUnknowns];
  const reasons = [
    ...(missing.length ? [`missing BOM fields: ${missing.join(", ")}`] : []),
    ...(lifecycleIssues.length
      ? [`unorderable lifecycle/availability: ${lifecycleIssues.join(", ")}`]
      : []),
    ...(total > input.budgetCap ? [`budget exceeded: ${total} > ${input.budgetCap}`] : []),
    ...(Object.values(input.artifactManifest).some((value) => !/^sha256:[0-9a-f]{64}$/.test(value))
      ? ["manufacturing artifact hash missing or invalid"]
      : []),
    ...(unknowns.length ? [`unresolved unknowns: ${unknowns.join(", ")}`] : []),
  ];
  return {
    ready: reasons.length === 0,
    components,
    fab: input.fabQuote.unitPrice,
    total,
    budgetCap: input.budgetCap,
    currency: input.fabQuote.currency,
    reasons,
    unresolvedUnknowns: unknowns,
    approvalRequired: true,
  };
};

export default { evaluatePreOrderReadiness };
