import type * as Admin from "@osdk/foundry.admin";
import type * as Orchestration from "@osdk/foundry.orchestration";
import { createClient } from "../client.ts";
import { EdroError } from "../errors.ts";
import { emptyState } from "../fake/fixtures.ts";
import type { FakeFoundryState } from "../fake/state.ts";
import { Scrubber } from "./scrub.ts";

/** The parts of a fake Foundry state that come from a recording. */
export type RecordedData = Pick<
  FakeFoundryState,
  "currentUser" | "builds" | "jobs" | "schedules" | "scheduleRuns"
>;

export interface RecordOptions {
  hostname: string;
  tokenProvider: () => Promise<string>;
  /** Hosts recording is allowed from: only personal instances. */
  allowedHosts: string[];
  fetch?: typeof globalThis.fetch;
  /** How many builds to fetch jobs for. */
  maxBuilds?: number;
  now?: () => number;
}

export interface RecordResult {
  data: RecordedData;
  counts: Record<keyof RecordedData, number>;
}

/** Refuses any host that isn't explicitly listed, so a work instance can't be recorded by accident. */
export function assertAllowedHost(hostname: string, allowedHosts: string[]): void {
  const host = hostname.toLowerCase();
  if (!allowedHosts.map((h) => h.trim().toLowerCase()).includes(host)) {
    throw new EdroError(
      `Refusing to record from ${hostname}: it isn't on the allowlist of personal instances.`,
      "config",
      "Add it to EDRO_FIXTURE_HOSTS, but only if it's your personal Developer Tier.",
    );
  }
}

/** Wraps fetch, keeping the raw JSON of every successful Platform API response. */
function capturingFetch(
  inner: typeof globalThis.fetch,
  captured: Array<{ path: string; body: unknown }>,
): typeof globalThis.fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit) => {
    const res = await inner(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      res.ok &&
      url.pathname.startsWith("/api/") &&
      res.headers.get("content-type")?.includes("json")
    ) {
      captured.push({ path: url.pathname, body: await res.clone().json() });
    }
    return res;
  };
  return wrapped as typeof globalThis.fetch;
}

function assemble(captured: Array<{ path: string; body: unknown }>): RecordedData {
  const data: RecordedData = {
    currentUser: emptyState().currentUser,
    builds: [],
    jobs: [],
    schedules: [],
    scheduleRuns: [],
  };
  const byRid = <T extends { rid: string }>(list: T[], item: T) => {
    if (!list.some((x) => x.rid === item.rid)) list.push(item);
  };
  for (const { path, body } of captured) {
    const page = body as { data: unknown[] };
    if (path.endsWith("/admin/users/getCurrent")) data.currentUser = body as Admin.User;
    else if (path.endsWith("/orchestration/builds/search"))
      for (const b of page.data as Orchestration.Build[]) byRid(data.builds, b);
    else if (/\/orchestration\/builds\/[^/]+\/jobs$/.test(path))
      for (const j of page.data as Orchestration.Job[]) byRid(data.jobs, j);
    else if (/\/orchestration\/builds\/[^/]+$/.test(path))
      byRid(data.builds, body as Orchestration.Build);
    else if (/\/orchestration\/schedules\/[^/]+\/runs$/.test(path))
      for (const r of page.data as Orchestration.ScheduleRun[]) byRid(data.scheduleRuns, r);
    else if (/\/orchestration\/schedules\/[^/]+$/.test(path))
      byRid(data.schedules, body as Orchestration.Schedule);
  }
  return data;
}

/**
 * Records a small snapshot from a personal instance: the current user, recent
 * builds and their jobs, and the schedules behind them. Everything is scrubbed,
 * and the result is refused if any original value survives scrubbing.
 */
export async function recordFixtures(options: RecordOptions): Promise<RecordResult> {
  assertAllowedHost(options.hostname, options.allowedHosts);
  const captured: Array<{ path: string; body: unknown }> = [];
  const client = createClient({
    hostname: options.hostname,
    tokenProvider: options.tokenProvider,
    fetch: capturingFetch(options.fetch ?? globalThis.fetch, captured),
  });

  await client.whoami();
  const now = options.now?.() ?? Date.now();
  const builds = (
    await client.builds.search({ since: new Date(now - 30 * 86_400_000), pageSize: 50 })
  ).items;
  for (const b of builds.slice(0, options.maxBuilds ?? 10)) await client.builds.jobs(b.rid);
  for (const rid of new Set(builds.map((b) => b.scheduleRid).filter((r): r is string => !!r))) {
    await client.schedules.get(rid);
    await client.schedules.runs(rid, { pageSize: 20 });
  }

  const token = await options.tokenProvider();
  const scrubber = new Scrubber(options.hostname, [token]);
  const data = scrubber.scrub(assemble(captured));
  const leaks = scrubber.leaks(JSON.stringify(data));
  if (leaks.length) {
    // Don't print the leaked values themselves.
    throw new EdroError(
      `Scrubbing left ${leaks.length} original value(s) in the output; nothing was written.`,
      "api",
      "Extend the scrubber in packages/mellon/src/record/scrub.ts to cover them.",
    );
  }
  return {
    data,
    counts: {
      currentUser: 1,
      builds: data.builds.length,
      jobs: data.jobs.length,
      schedules: data.schedules.length,
      scheduleRuns: data.scheduleRuns.length,
    },
  };
}

/** A fake Foundry state built from a recording, ready for `createFakeFetch`. */
export function stateFromRecording(data: RecordedData): FakeFoundryState {
  return { ...emptyState(), ...structuredClone(data) };
}
