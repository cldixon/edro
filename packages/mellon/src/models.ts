// Domain models. This is the JSON shape `--json` prints, so it's edro's
// contract with scripts and agents: change it deliberately, not because the
// SDK's response types moved.

export type BuildStatus = "running" | "succeeded" | "failed" | "canceled";

export interface Build {
  rid: string;
  status: BuildStatus;
  branch: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
  /** Milliseconds from creation to finish (or to now, while running). */
  durationMs: number;
  scheduleRid: string | null;
  jobRids: string[];
}

export type JobStatus = "waiting" | "running" | "succeeded" | "failed" | "canceled" | "did_not_run";

export interface JobOutput {
  type: "dataset" | "mediaSet";
  rid: string;
  transactionRid: string | null;
}

export interface Job {
  rid: string;
  buildRid: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  outputs: JobOutput[];
}

export interface Schedule {
  rid: string;
  name: string | null;
  description: string | null;
  paused: boolean;
  updatedAt: string;
}

export type ScheduleRunResult =
  | { type: "submitted"; buildRid: string }
  | { type: "ignored" }
  | { type: "error"; errorName: string; description: string }
  | { type: "pending" };

export interface ScheduleRun {
  rid: string;
  scheduleRid: string;
  createdAt: string;
  createdBy: string | null;
  result: ScheduleRunResult;
}

export interface CurrentUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
}

export interface Page<T> {
  items: T[];
  nextPageToken: string | null;
}

export function isFinished(status: BuildStatus): boolean {
  return status !== "running";
}
