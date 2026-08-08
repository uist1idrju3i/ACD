import type { Budget, BudgetUsageSnapshot } from "@acd/schema";
import { GraphCoreError, type ErrorCode } from "./errors.js";

export interface MonotonicClockPort {
  now(): number;
}

export type BudgetUsageEstimate = {
  attempts?: number;
  elapsedSeconds?: number;
  externalProcessExecutions?: number;
};

export type BudgetCheckStatus = "allowed" | "exhausted" | "would-exceed" | "unknown-impact";

export type BudgetCheckResult = {
  status: BudgetCheckStatus;
  remaining: {
    attempts?: number;
    elapsedSeconds?: number;
    externalProcessExecutions?: number;
  };
  reasonCode?: Extract<ErrorCode, "budget-exceeded" | "unknown-impact">;
};

const nonNegative = (value: number | undefined, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new GraphCoreError("schema-invalid", `${name} must be a finite non-negative number`);
  }
  return value;
};

export const createBudgetUsageSnapshot = (input: {
  scope: "run" | "task";
  attempts?: number;
  elapsedSeconds?: number;
  externalProcessExecutions?: number;
  logicalToolRequests?: number;
}): BudgetUsageSnapshot => ({
  scope: input.scope,
  attempts: nonNegative(input.attempts ?? 0, "attempts")!,
  elapsedSeconds: nonNegative(input.elapsedSeconds ?? 0, "elapsedSeconds")!,
  externalProcessExecutions: nonNegative(
    input.externalProcessExecutions ?? 0,
    "externalProcessExecutions",
  )!,
  logicalToolRequests: nonNegative(input.logicalToolRequests ?? 0, "logicalToolRequests")!,
  tokens: { status: "unknown" },
  money: { status: "unknown" },
});

export const validateBudgetUsageSnapshot = (usage: BudgetUsageSnapshot): void => {
  if (usage.scope !== "run" && usage.scope !== "task") {
    throw new GraphCoreError("schema-invalid", "budget usage scope is invalid");
  }
  for (const [name, value] of Object.entries(usage)) {
    if (
      name !== "scope" &&
      name !== "tokens" &&
      name !== "money" &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw new GraphCoreError("schema-invalid", `budget usage ${name} is invalid`);
    }
  }
  if (usage.tokens.status !== "unknown" || usage.money.status !== "unknown") {
    throw new GraphCoreError("schema-invalid", "unmeasured budget usage must remain unknown");
  }
};

export const elapsedSecondsBetween = (start: number, end: number): number => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new GraphCoreError(
      "schema-invalid",
      "monotonic timestamps must be finite and non-decreasing",
    );
  }
  return end - start;
};

export const checkBudget = (
  budget: Budget | undefined,
  usage: BudgetUsageSnapshot,
  estimate: BudgetUsageEstimate,
): BudgetCheckResult => {
  const remaining = {
    ...(budget?.timeSeconds === undefined
      ? {}
      : { elapsedSeconds: budget.timeSeconds - usage.elapsedSeconds }),
    ...(budget?.toolCalls === undefined
      ? {}
      : { externalProcessExecutions: budget.toolCalls - usage.externalProcessExecutions }),
  };
  if (!budget) return { status: "allowed", remaining };

  const checks: Array<{
    cap: number | undefined;
    current: number;
    next: number | undefined;
  }> = [
    {
      cap: budget.timeSeconds,
      current: usage.elapsedSeconds,
      next: estimate.elapsedSeconds,
    },
    {
      cap: budget.toolCalls,
      current: usage.externalProcessExecutions,
      next: estimate.externalProcessExecutions,
    },
  ];
  if (checks.some(({ cap, next }) => cap !== undefined && next === undefined)) {
    return { status: "unknown-impact", remaining, reasonCode: "unknown-impact" };
  }
  if (checks.some(({ cap, current }) => cap !== undefined && current >= cap)) {
    return { status: "exhausted", remaining, reasonCode: "budget-exceeded" };
  }
  if (checks.some(({ cap, current, next }) => cap !== undefined && current + (next ?? 0) >= cap)) {
    return { status: "would-exceed", remaining, reasonCode: "budget-exceeded" };
  }
  return { status: "allowed", remaining };
};
