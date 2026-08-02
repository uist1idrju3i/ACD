import { describe, expect, it } from "vitest";
import type { FabFeedbackReport } from "./fab-feedback.js";
import { intakeFabFeedback } from "./fab-feedback.js";
import { InMemoryEventLog } from "./event-log.js";
import { createFabFeedbackReceivedEvent } from "./fab-feedback.js";

const report = (overrides: Partial<FabFeedbackReport> = {}): FabFeedbackReport => ({
  schemaVersion: "0.1.0-draft",
  reportId: "fab-report:test",
  fabJobId: "job:test",
  fabProfileId: "fab:jlcpcb-class-2layer",
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
      originalText: "Solder mask sliver below minimum near R1 pad 1.",
      severityReported: "high",
      references: {
        partId: "part:r1",
        footprintId: "footprint:r0603",
        ruleId: "mask-sliver-min",
      },
    },
  ],
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
          originalText: "Solder mask sliver near R1 pad 1 has insufficient width.",
          severityReported: "medium",
          references: {
            partId: "part:r1",
            footprintId: "footprint:r0603",
            ruleId: "mask-sliver-min",
          },
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

  it("widens verification for unmatched free text", () => {
    const unknown = report({
      rawFindings: [
        {
          ...report().rawFindings[0]!,
          originalText: "Manufacturing says please check this thing somehow.",
          references: { partId: "part:r1" },
          severityReported: "low",
        },
      ],
    });
    const result = intakeFabFeedback(unknown, index);
    expect(result.verdict).toBe("unknown");
    expect(result.findings[0]?.verdict).toBe("unknown");
    expect(result.evidence.value.unknownFindingIds).toEqual(["F-1"]);
  });

  it("prioritizes an explicit rule ID over text-pattern matches", () => {
    const result = intakeFabFeedback(
      report({
        rawFindings: [
          {
            ...report().rawFindings[0]!,
            originalText: "Copper clearance below minimum at the board edge.",
            references: { partId: "part:r1", ruleId: "copper-clearance-min" },
          },
        ],
      }),
      index,
    );
    expect(result.findings[0]?.classification).toBe("spacing");
  });

  it("widens verification when text matches rules with different classifications", () => {
    const result = intakeFabFeedback(
      report({
        rawFindings: [
          {
            ...report().rawFindings[0]!,
            originalText: "mask sliver and copper clearance below minimum",
            references: { partId: "part:r1" },
          },
        ],
      }),
      index,
    );
    expect(result.verdict).toBe("unknown");
    expect(result.findings[0]?.classification).toBe("unknown");
  });

  it("merges duplicate severity and unknown status deterministically", () => {
    const duplicate = report({
      rawFindings: [
        {
          ...report().rawFindings[0]!,
          findingId: "F-2",
          severityReported: "low",
        },
        {
          ...report().rawFindings[0]!,
          findingId: "F-1",
          severityReported: "high",
        },
      ],
    });
    const result = intakeFabFeedback(duplicate, index);
    expect(result.findings[0]?.severityReported).toBe("high");
    expect(result.findings[0]?.duplicateFindingIds).toEqual(["F-2"]);
    expect(result.findings[0]?.originalText).toContain("Solder mask sliver");
  });

  it("does not pass findings without an entity reference", () => {
    const result = intakeFabFeedback(
      report({
        rawFindings: [
          {
            ...report().rawFindings[0]!,
            references: { coordinate: { xMm: 1, yMm: 2 } },
          },
        ],
      }),
      index,
    );
    expect(result.verdict).toBe("unknown");
    expect(result.findings[0]?.verdict).toBe("unknown");
  });

  it("does not unify distinct unknown findings", () => {
    const result = intakeFabFeedback(
      report({
        rawFindings: [
          {
            findingId: "UNKNOWN-1",
            originalText: "Please inspect this area.",
            severityReported: "low",
            references: { partId: "part:r1" },
          },
          {
            findingId: "UNKNOWN-2",
            originalText: "Please inspect this area again.",
            severityReported: "high",
            references: { partId: "part:r1" },
          },
        ],
      }),
      index,
    );
    expect(result.evidence.value.countAfter).toBe(2);
    expect(result.findings.map((finding) => finding.findingId)).toEqual(["UNKNOWN-1", "UNKNOWN-2"]);
  });

  it("stops on a target revision mismatch", () => {
    expect(() =>
      intakeFabFeedback(
        report({
          target: { projectId: "project:test", designRevision: "revision:2" },
        }),
        index,
      ),
    ).toThrowError(/does not match the design revision/);
  });

  it("stops on duplicate finding IDs", () => {
    expect(() =>
      intakeFabFeedback(
        report({
          rawFindings: [...report().rawFindings, { ...report().rawFindings[0]! }],
        }),
        index,
      ),
    ).toThrowError(/duplicate finding ID/);
  });

  it("verifies supplied derivation metadata instead of trusting it", () => {
    const derived = intakeFabFeedback(report(), index);
    expect(intakeFabFeedback(report({ derivation: derived.derivation }), index).derivation).toEqual(
      derived.derivation,
    );
    expect(() =>
      intakeFabFeedback(
        report({
          derivation: {
            ...derived.derivation,
            outputHash: "sha256:" + "f".repeat(64),
          },
        }),
        index,
      ),
    ).toThrowError(/derivation metadata/);
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
