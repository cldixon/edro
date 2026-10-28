// Converts SDK response types into edro's domain models.
import type * as Admin from "@osdk/foundry.admin";
import type * as Orchestration from "@osdk/foundry.orchestration";
import type {
  Build,
  BuildStatus,
  CurrentUser,
  Job,
  JobStatus,
  Schedule,
  ScheduleRun,
} from "./models.ts";

function durationMs(start: string, end: string | undefined, now: number): number {
  return Math.max(0, (end ? Date.parse(end) : now) - Date.parse(start));
}

export function toBuild(b: Orchestration.Build, now = Date.now()): Build {
  return {
    rid: b.rid,
    status: b.status.toLowerCase() as BuildStatus,
    branch: b.branchName,
    createdBy: b.createdBy,
    createdAt: b.createdTime,
    finishedAt: b.finishedTime ?? null,
    durationMs: durationMs(b.createdTime, b.finishedTime, now),
    scheduleRid: b.scheduleRid ?? null,
    jobRids: b.jobRids,
  };
}

export function toJob(j: Orchestration.Job, now = Date.now()): Job {
  return {
    rid: j.rid,
    buildRid: j.buildRid,
    status: j.jobStatus.toLowerCase() as JobStatus,
    startedAt: j.startedTime,
    finishedAt: j.finishedTime ?? null,
    durationMs: durationMs(j.startedTime, j.finishedTime, now),
    outputs: j.outputs.map((o) =>
      o.type === "datasetJobOutput"
        ? { type: "dataset", rid: o.datasetRid, transactionRid: o.outputTransactionRid ?? null }
        : { type: "mediaSet", rid: o.mediaSetRid, transactionRid: o.transactionId ?? null },
    ),
  };
}

export function toSchedule(s: Orchestration.Schedule): Schedule {
  return {
    rid: s.rid,
    name: s.displayName ?? null,
    description: s.description ?? null,
    paused: s.paused,
    updatedAt: s.updatedTime,
  };
}

export function toScheduleRun(r: Orchestration.ScheduleRun): ScheduleRun {
  const result: ScheduleRun["result"] = !r.result
    ? { type: "pending" }
    : r.result.type === "submitted"
      ? { type: "submitted", buildRid: r.result.buildRid }
      : r.result.type === "error"
        ? { type: "error", errorName: r.result.errorName, description: r.result.description }
        : { type: "ignored" };
  return {
    rid: r.rid,
    scheduleRid: r.scheduleRid,
    createdAt: r.createdTime,
    createdBy: r.createdBy ?? null,
    result,
  };
}

export function toCurrentUser(u: Admin.User): CurrentUser {
  const name = [u.givenName, u.familyName].filter(Boolean).join(" ");
  return { id: u.id, username: u.username, name: name || null, email: u.email ?? null };
}
