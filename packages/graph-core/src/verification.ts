import { GraphCoreError } from "./errors.js";

export const assertFreshResult = (currentRevision: number, resultRevision: number): void => {
  if (resultRevision !== currentRevision) {
    throw new GraphCoreError(
      "stale-result",
      "verification result does not match current revision",
      "error",
      {
        currentRevision,
        resultRevision,
      },
    );
  }
};
