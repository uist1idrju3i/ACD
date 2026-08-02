import { readFile } from "node:fs/promises";
import { physicalEvidenceSchemaPath } from "./paths.js";
import { createSchemaValidator } from "./validator.js";
import type { ACDPhase1PhysicalEvidence as PhysicalEvidence } from "./generated/physical-evidence.js";

export type PhysicalEvidenceVerdict = {
  valid: boolean;
  passed: boolean;
  reason?: string;
};

export const evaluatePhysicalEvidence = async (
  evidence: unknown,
): Promise<PhysicalEvidenceVerdict> => {
  const ajv = createSchemaValidator();
  const schema = JSON.parse(await readFile(physicalEvidenceSchemaPath, "utf8")) as object;
  const validate = ajv.compile(schema);
  if (!validate(evidence)) {
    return {
      valid: false,
      passed: false,
      reason: (validate.errors ?? []).map((error) => error.message ?? "invalid").join("; "),
    };
  }
  const typed = evidence as PhysicalEvidence;
  if (typed.provenance.mode !== "real" || typed.status !== "passed") {
    return {
      valid: true,
      passed: false,
      reason: "physical evidence is simulated or pending; real hardware evidence is required",
    };
  }
  if (
    typed.assembly.status !== "assembled" ||
    typed.instruments.length === 0 ||
    Object.keys(typed.conditions ?? {}).length === 0 ||
    typed.instruments.some((instrument) => instrument.calibrationStatus !== "valid") ||
    typed.testItems.some(
      (item) =>
        !item.pass ||
        item.observed === null ||
        item.observed === undefined ||
        item.expected === null ||
        item.expected === undefined,
    )
  ) {
    return {
      valid: true,
      passed: false,
      reason: "physical evidence acceptance conditions are incomplete",
    };
  }
  return { valid: true, passed: true };
};
