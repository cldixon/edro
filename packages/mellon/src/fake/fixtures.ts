import type * as Orchestration from "@osdk/foundry.orchestration";
import { type FakeFoundryState, fakeRid } from "./state.ts";

// Made-up data for tests and demo mode. Nothing here comes from a real instance.

export const FAKE_HOSTNAME = "example.palantirfoundry.com";
export const FAKE_TOKEN = "fake-token";
export const FAKE_USER_ID = "00000000-0000-0000-0000-00000000a11c";

export const DATASETS = {
  rawOrders: fakeRid("dataset", 1),
  cleanOrders: fakeRid("dataset", 2),
  dailyRevenue: fakeRid("dataset", 3),
};

export const NIGHTLY_SCHEDULE = fakeRid("schedule", 1, "scheduler");

const MINUTE = 60_000;

/** Three jobs forming the demo pipeline: raw orders → clean orders → daily revenue. */
export const PIPELINE = [DATASETS.cleanOrders, DATASETS.dailyRevenue, DATASETS.rawOrders];

export function emptyState(): FakeFoundryState {
  return {
    tokens: [FAKE_TOKEN],
    oauthClients: { "fake-client-id": "fake-client-secret" },
    currentUser: {
      id: FAKE_USER_ID,
      username: "ada.example",
      givenName: "Ada",
      familyName: "Example",
      email: "ada@example.com",
      realm: "palantir-internal-realm",
      status: "ACTIVE",
      attributes: {},
    },
    builds: [],
    jobs: [],
    schedules: [],
    scheduleRuns: [],
  };
}

let counter = 0;

/** Adds a finished or running build with one job per output dataset. */
export function addBuild(
  state: FakeFoundryState,
  opts: {
    createdAt: number;
    status: Orchestration.BuildStatus;
    durationMs?: number;
    branch?: string;
    scheduled?: boolean;
    outputs?: string[];
  },
): Orchestration.Build {
  counter += 1;
  const rid = fakeRid("build", counter);
  const outputs = opts.outputs ?? PIPELINE;
  const finishedAt =
    opts.status === "RUNNING"
      ? undefined
      : new Date(opts.createdAt + (opts.durationMs ?? 4 * MINUTE));
  const jobRids = outputs.map((datasetRid, i) => {
    const jobRid = fakeRid("job", counter * 100 + i);
    const last = i === outputs.length - 1;
    state.jobs.push({
      rid: jobRid,
      buildRid: rid,
      startedTime: new Date(opts.createdAt + i * 1000).toISOString(),
      finishedTime: last
        ? finishedAt?.toISOString()
        : new Date(opts.createdAt + (i + 1) * 1000).toISOString(),
      // Earlier jobs succeeded; the last one carries the build's outcome.
      jobStatus: last ? opts.status : "SUCCEEDED",
      outputs: [{ type: "datasetJobOutput", datasetRid }],
    });
    return jobRid;
  });
  const build: Orchestration.Build = {
    rid,
    branchName: opts.branch ?? "master",
    createdTime: new Date(opts.createdAt).toISOString(),
    createdBy: FAKE_USER_ID,
    fallbackBranches: [],
    jobRids,
    retryCount: 0,
    retryBackoffDuration: { unit: "SECONDS", value: 0 },
    abortOnFailure: false,
    status: opts.status,
    finishedTime: finishedAt?.toISOString(),
    scheduleRid: opts.scheduled === false ? undefined : NIGHTLY_SCHEDULE,
  };
  state.builds.push(build);
  if (build.scheduleRid) {
    state.scheduleRuns.push({
      rid: fakeRid("schedule-run", counter, "scheduler"),
      scheduleRid: build.scheduleRid,
      scheduleVersionRid: fakeRid("schedule-version", 1, "scheduler"),
      createdTime: build.createdTime,
      result: { type: "submitted", buildRid: rid },
    });
  }
  return build;
}

/** A small, fixed set of builds relative to `now`, for tests. */
export function sampleState(now = Date.now()): FakeFoundryState {
  const state = emptyState();
  state.schedules.push({
    rid: NIGHTLY_SCHEDULE,
    displayName: "Nightly revenue pipeline",
    description: "Builds daily_revenue from raw_orders.",
    currentVersionRid: fakeRid("schedule-version", 1, "scheduler"),
    createdTime: new Date(now - 30 * 24 * 60 * MINUTE).toISOString(),
    createdBy: FAKE_USER_ID,
    updatedTime: new Date(now - 2 * 24 * 60 * MINUTE).toISOString(),
    updatedBy: FAKE_USER_ID,
    paused: false,
    action: {
      target: { type: "manual", targetRids: [DATASETS.dailyRevenue] },
      branchName: "master",
      fallbackBranches: [],
      abortOnFailure: false,
      forceBuild: false,
      notificationsEnabled: false,
    },
    scopeMode: { type: "user" },
  });
  addBuild(state, {
    createdAt: now - 26 * 60 * MINUTE,
    status: "SUCCEEDED",
    durationMs: 5 * MINUTE,
  });
  addBuild(state, { createdAt: now - 2 * 60 * MINUTE, status: "FAILED", durationMs: 2 * MINUTE });
  addBuild(state, {
    createdAt: now - 40 * MINUTE,
    status: "SUCCEEDED",
    branch: "feature/new-metrics",
    scheduled: false,
    durationMs: 3 * MINUTE,
  });
  addBuild(state, { createdAt: now - 3 * MINUTE, status: "RUNNING" });
  return state;
}
