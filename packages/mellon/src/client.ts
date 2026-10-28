import { createPlatformClient, type PlatformClient } from "@osdk/client";
import { Users } from "@osdk/foundry.admin";
import { Builds, Schedules, type SearchBuildsFilter } from "@osdk/foundry.orchestration";
import { toBuild, toCurrentUser, toJob, toSchedule, toScheduleRun } from "./convert.ts";
import { toEdroError } from "./errors.ts";
import type {
  Build,
  BuildStatus,
  CurrentUser,
  Job,
  Page,
  Schedule,
  ScheduleRun,
} from "./models.ts";

export interface ClientOptions {
  /** e.g. `example.palantirfoundry.com`, without a scheme. */
  hostname: string;
  tokenProvider: () => Promise<string>;
  /** Swapped out by tests and demo mode to serve fake responses. */
  fetch?: typeof globalThis.fetch;
  /** The clock for default time windows; tests and demo mode pass their own. */
  now?: () => number;
}

export interface BuildQuery {
  status?: BuildStatus[];
  branch?: string;
  /** Only builds started at or after this time. Defaults to 24 hours ago. */
  since?: Date;
  /** Only builds started by this user ID. */
  createdBy?: string;
  /** Only the current user's builds. Much cheaper on busy instances. */
  mine?: boolean;
  pageSize?: number;
  pageToken?: string;
}

export interface PageQuery {
  pageSize?: number;
  pageToken?: string;
}

/**
 * The only surface the CLI and TUI use to talk to Foundry. Everything
 * Foundry-specific stays behind this interface, so the SDK can be swapped,
 * mocked or wrapped in one place.
 */
export interface MellonClient {
  readonly hostname: string;
  whoami(): Promise<CurrentUser>;
  builds: {
    search(query?: BuildQuery): Promise<Page<Build>>;
    get(buildRid: string): Promise<Build>;
    jobs(buildRid: string, query?: PageQuery): Promise<Page<Job>>;
  };
  schedules: {
    get(scheduleRid: string): Promise<Schedule>;
    runs(scheduleRid: string, query?: PageQuery): Promise<Page<ScheduleRun>>;
  };
  /** Link to a resource in the Foundry web UI. */
  webUrl(rid: string): string;
}

// Build search gets slow on busy instances as the window grows, so keep the
// default short; --since widens it.
export const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export function buildSearchFilter(query: BuildQuery, now = Date.now()): SearchBuildsFilter {
  const since = query.since ?? new Date(now - DEFAULT_LOOKBACK_MS);
  const items: SearchBuildsFilter[] = [
    { type: "gte", field: "STARTED_TIME", value: since.toISOString() },
  ];
  if (query.branch) items.push({ type: "eq", field: "BRANCH_NAME", value: query.branch });
  if (query.createdBy) items.push({ type: "eq", field: "CREATED_BY", value: query.createdBy });
  if (query.status?.length) {
    const byStatus: SearchBuildsFilter[] = query.status.map((s) => ({
      type: "eq",
      field: "STATUS",
      value: s.toUpperCase(),
    }));
    items.push(
      byStatus.length === 1 ? (byStatus[0] as SearchBuildsFilter) : { type: "or", items: byStatus },
    );
  }
  return items.length === 1 ? (items[0] as SearchBuildsFilter) : { type: "and", items };
}

/** Runs an SDK call, converting failures into EdroErrors. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toEdroError(e);
  }
}

export function createClient(options: ClientOptions): MellonClient {
  const platform: PlatformClient = createPlatformClient(
    `https://${options.hostname}`,
    options.tokenProvider,
    undefined,
    options.fetch,
  );

  // The current user, fetched once per client (`mine` searches need its ID).
  let currentUser: Promise<CurrentUser> | undefined;
  const whoami = () => {
    currentUser ??= call(async () => toCurrentUser(await Users.getCurrent(platform)));
    currentUser.catch(() => {
      currentUser = undefined;
    });
    return currentUser;
  };

  return {
    hostname: options.hostname,

    whoami,

    builds: {
      search: (query = {}) =>
        call(async () => {
          const createdBy = query.mine ? (await whoami()).id : query.createdBy;
          // Build search is still a preview endpoint.
          const res = await Builds.search(
            platform,
            {
              where: buildSearchFilter({ ...query, createdBy }, (options.now ?? Date.now)()),
              orderBy: { fields: [{ field: "STARTED_TIME", direction: "DESC" }] },
              pageSize: query.pageSize,
              pageToken: query.pageToken,
            },
            { preview: true },
          );
          return {
            items: res.data.map((b) => toBuild(b)),
            nextPageToken: res.nextPageToken ?? null,
          };
        }),
      get: (rid) => call(async () => toBuild(await Builds.get(platform, rid))),
      jobs: (rid, query = {}) =>
        call(async () => {
          const res = await Builds.jobs(platform, rid, query);
          return { items: res.data.map((j) => toJob(j)), nextPageToken: res.nextPageToken ?? null };
        }),
    },

    schedules: {
      get: (rid) =>
        call(async () => toSchedule(await Schedules.get(platform, rid, { preview: true }))),
      runs: (rid, query = {}) =>
        call(async () => {
          const res = await Schedules.runs(platform, rid, query);
          return { items: res.data.map(toScheduleRun), nextPageToken: res.nextPageToken ?? null };
        }),
    },

    webUrl: (rid) => webUrl(options.hostname, rid),
  };
}

/**
 * Best-effort links into the Foundry web UI. These paths aren't part of the
 * public API; verify them against the Developer Tier.
 */
export function webUrl(hostname: string, rid: string): string {
  const base = `https://${hostname}/workspace`;
  if (rid.startsWith("ri.foundry.main.build.")) {
    return `${base}/data-integration/job-tracker/builds/${rid}`;
  }
  if (rid.startsWith("ri.foundry.main.dataset.")) {
    return `${base}/data-integration/dataset/preview/${rid}`;
  }
  return `${base}/compass/view/${rid}`;
}

/** Follows `nextPageToken` until there are no more pages, or `limit` items. */
export async function collectPages<T>(
  fetchPage: (pageToken?: string) => Promise<Page<T>>,
  limit = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const items: T[] = [];
  let token: string | undefined;
  do {
    const page = await fetchPage(token);
    items.push(...page.items);
    token = page.nextPageToken ?? undefined;
  } while (token && items.length < limit);
  return items.slice(0, limit);
}
