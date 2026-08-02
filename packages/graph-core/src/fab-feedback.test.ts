import { describe, expect, it } from "vitest";
import type { FabFeedbackReport } from "./fab-feedback.js";
import { intakeFabFeedback } from "./fab-feedback.js";
import { InMemoryEventLog } from "./event-log.js";
import { createFabFeedbackReceivedEvent } from "./fab-feedback.js";

const report = (overrides: Partial<FabFeedbackReport> = {}): FabFeedbackReport => ({
  schemaVersion: "0.1.0-draft",
  reportId: "fab-report:test",
  fabJobId: "job:test",
  fabProfileId: "fab:test",
  source: {
    kind: "fixture",
    locator: "fixture:test",
    contentHash: "sha256:" + "a".repeat(64),
    fixtureDerived: true,
    fixtureId: "fixture:test",
  },
  target: { projectId: "project:test", designRevision: "revision:1" },
  rawReport: {
    contentType: "text/plain",
    content: "fixture",
    contentHash: "sha256:" + "a".repeat(64),
  },
  rawFindings: [
    {
      findingId: "F-1",
      originalText: "mask sliver at R1",
      severityReported: "high",
      references: { partId: "part:r1", footprintId: "footprint:r0603", ruleId: "mask" },
    },
  ],
  structuredFindings: [
    {
      findingId: "F-1",
      classification: "mask-clearance",
      confidence: 0.95,
      reproductionConditions: ["2-layer"],
      derivedFromFindingIds: ["F-1"],
    },
  ],
  derivation: {
    method: "test",
    version: "1",
    inputHash: "sha256:" + "a".repeat(64),
    outputHash: "sha256:" + "b".repeat(64),
  },
  ...overrides,
});

const index = {
  projectId: "project:test",
  designRevision: "revision:1",
  entityIds: new Set(["part:r1", "footprint:r0603", "rule:mask", "mask"]),
};

describe("fab feedback intake", () => {
  it("is deterministic for the same report", () => {
    const first = intakeFabFeedback(report(), index);
    const second = intakeFabFeedback(report(), index);
    expect(second).toEqual(first);
    expect(first.verdict).toBe("pass");
  });

  it("unifies duplicate findings and records the basis", () => {
    const duplicate = report({
      rawFindings: [
        ...report().rawFindings,
        {
          findingId: "F-2",
          originalText: "MASK SLIVER AT R1",
          severityReported: "medium",
          references: { partId: "part:r1", footprintId: "footprint:r0603", ruleId: "mask" },
        },
      ],
      structuredFindings: [
        ...report().structuredFindings,
        {
          findingId: "F-2",
          classification: "mask-clearance",
          confidence: 0.9,
          reproductionConditions: ["2-layer"],
          derivedFromFindingIds: ["F-2"],
        },
      ],
    });
    const result = intakeFabFeedback(duplicate, index);
    expect(result.evidence.value.countBefore).toBe(2);
    expect(result.evidence.value.countAfter).toBe(1);
    expect(result.findings[0]?.duplicateFindingIds).toEqual(["F-2"]);
  });

  it("stops on an unknown design reference", () => {
    expect(() =>
      intakeFabFeedback(
        report({
          rawFindings: [
            {
              ...report().rawFindings[0]!,
              references: { partId: "part:missing" },
            },
          ],
        }),
        index,
      ),
    ).toThrowError(/outside the target revision/);
  });

  it("widens verification for low confidence and unknown classification", () => {
    const unknown = report({
      structuredFindings: [
        {
          ...report().structuredFindings[0]!,
          classification: "unknown",
          confidence: 0.2,
        },
      ],
    });
    const result = intakeFabFeedback(unknown, index);
    expect(result.verdict).toBe("unknown");
    expect(result.findings[0]?.verdict).toBe("unknown");
    expect(result.evidence.value.unknownFindingIds).toEqual(["F-1"]);
  });

  it("records a payload-hashed fab feedback event", async () => {
    const intake = intakeFabFeedback(report(), index);
    const event = createFabFeedbackReceivedEvent({
      eventId: "event:fab-feedback:test",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "fixture:test",
      projectId: "project:test",
      baseRevision: 0,
      resultRevision: 0,
      report: report(),
      intake,
    });
    const log = new InMemoryEventLog();
    await log.append(event);
    expect((await log.readAll())[0]?.payloadHash).toBe(event.payloadHash);
  });
});
