import { createClient, type MellonClient } from "../client.ts";
import { createFakeFetch } from "./fetch.ts";
import { addBuild, FAKE_HOSTNAME, FAKE_TOKEN, sampleState } from "./fixtures.ts";
import type { FakeFoundryState } from "./state.ts";

/** A new scheduled build starts this often. */
const BUILD_INTERVAL_MS = 45_000;
/** Each job in a demo build takes this long. */
const JOB_MS = 8_000;

/**
 * Moves the demo forward to `now`: starts a new build when the last one is old
 * enough, and progresses running builds job by job. Every third demo build
 * fails on its last job, so failures show up too.
 */
export function advanceDemo(state: FakeFoundryState, now = Date.now()): void {
  const latest = state.builds.reduce((max, b) => Math.max(max, Date.parse(b.createdTime)), 0);
  if (now - latest >= BUILD_INTERVAL_MS) {
    const build = addBuild(state, { createdAt: now, status: "RUNNING" });
    for (const job of state.jobs.filter((j) => j.buildRid === build.rid)) {
      job.jobStatus = "WAITING";
      job.finishedTime = undefined;
    }
  }

  for (const build of state.builds.filter((b) => b.status === "RUNNING")) {
    const started = Date.parse(build.createdTime);
    const fails = state.builds.indexOf(build) % 3 === 2;
    const jobs = build.jobRids
      .map((rid) => state.jobs.find((j) => j.rid === rid))
      .filter((j) => !!j);
    jobs.forEach((job, i) => {
      const jobStart = started + i * JOB_MS;
      const jobEnd = jobStart + JOB_MS;
      if (now >= jobEnd) {
        job.jobStatus = fails && i === jobs.length - 1 ? "FAILED" : "SUCCEEDED";
        job.finishedTime = new Date(jobEnd).toISOString();
      } else if (now >= jobStart) {
        job.jobStatus = "RUNNING";
        job.startedTime = new Date(jobStart).toISOString();
      }
    });
    if (jobs.every((j) => j.finishedTime)) {
      build.status = jobs.some((j) => j.jobStatus === "FAILED") ? "FAILED" : "SUCCEEDED";
      build.finishedTime = new Date(started + jobs.length * JOB_MS).toISOString();
    }
  }
}

/** A client backed by made-up, live-updating data. Needs no credentials or network. */
export function createDemoClient(clock: () => number = Date.now): MellonClient {
  const state = sampleState(clock());
  // Drop the sample's running build; the simulation starts its own at once.
  const running = new Set(state.builds.filter((b) => b.status === "RUNNING").map((b) => b.rid));
  state.builds = state.builds.filter((b) => !running.has(b.rid));
  state.jobs = state.jobs.filter((j) => !running.has(j.buildRid));
  state.scheduleRuns = state.scheduleRuns.filter(
    (r) => r.result?.type !== "submitted" || !running.has(r.result.buildRid),
  );
  return createClient({
    hostname: FAKE_HOSTNAME,
    tokenProvider: async () => FAKE_TOKEN,
    fetch: createFakeFetch(state, { beforeRequest: (s) => advanceDemo(s, clock()) }),
  });
}
