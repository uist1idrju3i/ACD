export const schemaPackageVersion = "0.1.0";
export * from "./validator.js";
export type { ACDDesignGraphPhase0Draft, Entity, Id } from "./generated/design-graph.js";
export type { ACDPatchEnvelope as PatchEnvelope } from "./generated/patch.js";
export type { ACDEventEnvelope as EventEnvelope } from "./generated/event.js";
export type { ACDPhase1Fixture as Phase1Fixture } from "./generated/phase1-fixture.js";
export type { ACDPhase1PhysicalEvidence as PhysicalEvidence } from "./generated/physical-evidence.js";
export type { ACDFabFeedbackReport as FabFeedbackReport } from "./generated/fab-feedback.js";
export type { RawFinding, Reference, StructuredFinding } from "./generated/fab-feedback.js";
export { validatePhase1FixtureReferences } from "./phase1-semantic.js";
export { evaluatePhysicalEvidence } from "./physical-evidence.js";
export type { PhysicalEvidenceVerdict } from "./physical-evidence.js";
export {
  gateByOrder,
  gatesInExecutionOrder,
  gateMatrixSectionEnd,
  gateMatrixSectionMatches,
  gateMatrixSectionStart,
  gatesForScope,
  loadGateMatrix,
  missingExecutedGates,
  renderGateMatrixTable,
  replaceGateMatrixSection,
} from "./gate-matrix.js";
export type { GateDefinition, GateMatrix, GateScope, GateTableOptions } from "./gate-matrix.js";
export {
  fabFeedbackSamplePath,
  gateMatrixDataPath,
  gatesDocPath,
  phase1GatesDocPath,
  repositoryRoot,
} from "./paths.js";
