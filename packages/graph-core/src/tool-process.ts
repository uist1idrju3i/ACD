export type ProcessResultKind = "completed" | "timedOut" | "cancelled" | "failed";

export type ProcessSpec = {
  command: string;
  args: string[];
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  killGraceMs: number;
  signal?: AbortSignal;
};

export type ProcessResult = {
  kind: ProcessResultKind;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputBytes: number;
};

export interface ProcessPort {
  execute(spec: ProcessSpec): Promise<ProcessResult>;
}
