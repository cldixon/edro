import type * as Orchestration from "@osdk/foundry.orchestration";
import type { FakeFoundryState } from "./state.ts";

// A fake `fetch` that answers the subset of the Platform API edro uses, from
// in-memory state. The real SDK runs on top of it, so tests exercise the same
// request building and response handling as production.

export interface FakeFetchOptions {
  /** Called before every request; demo mode uses it to advance the simulation. */
  beforeRequest?: (state: FakeFoundryState) => void;
  /** Every request made, for assertions in tests. */
  log?: Request[];
}

type Handler = (
  req: Request,
  params: string[],
  state: FakeFoundryState,
) => Promise<Response> | Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Foundry's error body format. */
export function apiError(
  status: number,
  errorName: string,
  parameters: Record<string, unknown> = {},
) {
  const errorCode =
    { 400: "INVALID_ARGUMENT", 401: "UNAUTHORIZED", 403: "PERMISSION_DENIED", 404: "NOT_FOUND" }[
      status
    ] ?? "INTERNAL";
  return json(
    { errorCode, errorName, errorInstanceId: "00000000-0000-0000-0000-00000000e440", parameters },
    status,
  );
}

function paginate<T>(items: T[], url: URL, body?: { pageSize?: number; pageToken?: string }) {
  const pageSize = Number(body?.pageSize ?? url.searchParams.get("pageSize") ?? 100);
  const offset = Number(body?.pageToken ?? url.searchParams.get("pageToken") ?? 0);
  const next = offset + pageSize;
  return {
    data: items.slice(offset, next),
    ...(next < items.length ? { nextPageToken: String(next) } : {}),
  };
}

function matches(build: Orchestration.Build, filter: Orchestration.SearchBuildsFilter): boolean {
  switch (filter.type) {
    case "and":
      return filter.items.every((f) => matches(build, f));
    case "or":
      return filter.items.some((f) => matches(build, f));
    case "not":
      return !matches(build, filter.value);
    case "eq": {
      const actual = {
        CREATED_BY: build.createdBy,
        BRANCH_NAME: build.branchName,
        STATUS: build.status,
        RID: build.rid,
      }[filter.field];
      return actual === filter.value;
    }
    case "gte":
    case "lt": {
      const time = filter.field === "STARTED_TIME" ? build.createdTime : build.finishedTime;
      if (!time) return false;
      const diff = Date.parse(time) - Date.parse(filter.value);
      return filter.type === "gte" ? diff >= 0 : diff < 0;
    }
  }
}

const routes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ["GET", /^\/api\/v2\/admin\/users\/getCurrent$/, (_r, _p, s) => json(s.currentUser)],
  [
    "POST",
    /^\/api\/v2\/orchestration\/builds\/search$/,
    async (req, _p, s) => {
      const url = new URL(req.url);
      if (url.searchParams.get("preview") !== "true") {
        return apiError(400, "ApiFeaturePreviewUsageOnly");
      }
      const body = (await req.json()) as Orchestration.SearchBuildsRequest;
      const found = s.builds
        .filter((b) => matches(b, body.where))
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return json(paginate(found, url, body));
    },
  ],
  [
    "GET",
    /^\/api\/v2\/orchestration\/builds\/([^/]+)$/,
    (_r, [rid], s) => {
      const build = s.builds.find((b) => b.rid === rid);
      return build ? json(build) : apiError(404, "BuildNotFound", { buildRid: rid });
    },
  ],
  [
    "GET",
    /^\/api\/v2\/orchestration\/builds\/([^/]+)\/jobs$/,
    (req, [rid], s) => {
      if (!s.builds.some((b) => b.rid === rid))
        return apiError(404, "BuildNotFound", { buildRid: rid });
      return json(
        paginate(
          s.jobs.filter((j) => j.buildRid === rid),
          new URL(req.url),
        ),
      );
    },
  ],
  [
    "GET",
    /^\/api\/v2\/orchestration\/schedules\/([^/]+)$/,
    (_r, [rid], s) => {
      const schedule = s.schedules.find((x) => x.rid === rid);
      return schedule ? json(schedule) : apiError(404, "ScheduleNotFound", { scheduleRid: rid });
    },
  ],
  [
    "GET",
    /^\/api\/v2\/orchestration\/schedules\/([^/]+)\/runs$/,
    (req, [rid], s) => {
      if (!s.schedules.some((x) => x.rid === rid)) {
        return apiError(404, "ScheduleNotFound", { scheduleRid: rid });
      }
      const runs = s.scheduleRuns
        .filter((r) => r.scheduleRid === rid)
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return json(paginate(runs, new URL(req.url)));
    },
  ],
];

async function tokenEndpoint(req: Request, state: FakeFoundryState): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = req.headers.get("Authorization")?.match(/^Basic (.+)$/)?.[1];
  if (basic) {
    [id, secret] = atob(basic).split(":").map(decodeURIComponent) as [string, string];
  }
  if (form.get("grant_type") !== "client_credentials" || !id || state.oauthClients[id] !== secret) {
    return json({ error: "invalid_client" }, 401);
  }
  const token = `fake-oauth-token-${state.tokens.length}`;
  state.tokens.push(token);
  return json({
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    scope: form.get("scope"),
  });
}

export function createFakeFetch(
  state: FakeFoundryState,
  options: FakeFetchOptions = {},
): typeof fetch {
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const req =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    options.log?.push(req.clone() as Request);
    options.beforeRequest?.(state);
    const url = new URL(req.url);

    if (url.pathname === "/multipass/api/oauth2/token" && req.method === "POST") {
      return tokenEndpoint(req, state);
    }

    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !state.tokens.includes(token)) return apiError(401, "MissingCredentials");

    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && req.method === method)
        return handler(req, m.slice(1).map(decodeURIComponent), state);
    }
    return apiError(404, "ApiNotFound", { path: url.pathname });
  };
  return fakeFetch as typeof fetch;
}
