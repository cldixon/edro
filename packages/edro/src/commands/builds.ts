import { type Build, type BuildStatus, collectPages, isFinished, type Job } from "@edro/mellon";
import type { CommandContext } from "../context.ts";
import { EXIT, UsageError } from "../exit.ts";
import { formatAgo, formatDuration, formatStatus, parseSince, table } from "../format.ts";
import { allUsersFlag, type CommandDef, connectionFlags, jsonFlag } from "./types.ts";

const BUILD_STATUSES: BuildStatus[] = ["running", "succeeded", "failed", "canceled"];

export function parseStatuses(value: unknown): BuildStatus[] | undefined {
  if (typeof value !== "string") return undefined;
  const statuses = value.split(",").map((s) => s.trim().toLowerCase());
  for (const s of statuses) {
    if (!BUILD_STATUSES.includes(s as BuildStatus)) {
      throw new UsageError(`Invalid --status "${s}". Use ${BUILD_STATUSES.join(", ")}.`);
    }
  }
  return statuses as BuildStatus[];
}

export function parseLimit(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`Invalid --limit "${value}".`);
  return n;
}

function requireRid(ctx: CommandContext, usage: string): string {
  const [rid] = ctx.rest;
  if (!rid) throw new UsageError(`Usage: ${usage}`);
  return rid;
}

export function buildRows(builds: Build[], color: boolean, now: number): string[] {
  return table(
    ["status", "branch", "started", "duration", "schedule", "rid"],
    builds.map((b) => [
      formatStatus(b.status, color),
      b.branch,
      formatAgo(b.createdAt, now),
      formatDuration(b.durationMs),
      b.scheduleRid ? "yes" : "",
      b.rid,
    ]),
  );
}

function jobRows(jobs: Job[], color: boolean): string[] {
  return table(
    ["status", "duration", "outputs", "rid"],
    jobs.map((j) => [
      formatStatus(j.status, color),
      formatDuration(j.durationMs),
      j.outputs.map((o) => o.rid).join(", "),
      j.rid,
    ]),
  );
}

function printBuild(ctx: CommandContext, b: Build): void {
  const { io } = ctx.deps;
  io.out(`build     ${b.rid}`);
  io.out(`status    ${formatStatus(b.status, io.color)}`);
  io.out(`branch    ${b.branch}`);
  io.out(`started   ${b.createdAt} (${formatAgo(b.createdAt, ctx.deps.now())})`);
  io.out(`finished  ${b.finishedAt ?? "-"}`);
  io.out(`duration  ${formatDuration(b.durationMs)}`);
  io.out(`schedule  ${b.scheduleRid ?? "-"}`);
  io.out(`jobs      ${b.jobRids.length}`);
}

export const buildCommands: CommandDef[] = [
  {
    path: ["builds", "ls"],
    description: "List your recent builds, newest first",
    flags: [
      { name: "status", description: "Filter by status (comma-separated)", values: BUILD_STATUSES },
      {
        name: "since",
        description: "Only builds started since, e.g. 6h, 2d or an ISO date (default 24h)",
      },
      { name: "branch", description: "Filter by branch" },
      { name: "limit", description: "Maximum builds to show (default 20)" },
      { name: "all", description: "Fetch every matching build", boolean: true },
      allUsersFlag,
      jsonFlag,
      ...connectionFlags,
    ],
    async run(ctx) {
      const { args, deps } = ctx;
      const client = await ctx.client();
      const limit = args.all ? Number.POSITIVE_INFINITY : parseLimit(args.limit, 20);
      const query = {
        status: parseStatuses(args.status),
        branch: typeof args.branch === "string" ? args.branch : undefined,
        since: typeof args.since === "string" ? parseSince(args.since, deps.now()) : undefined,
        pageSize: Math.min(limit, 100),
        mine: !args["all-users"],
      };
      const builds = await collectPages(
        (pageToken) => client.builds.search({ ...query, pageToken }),
        limit,
      );
      if (ctx.json) deps.io.out(JSON.stringify(builds));
      else if (builds.length === 0) deps.io.out("No builds found.");
      else for (const line of buildRows(builds, deps.io.color, deps.now())) deps.io.out(line);
      return EXIT.ok;
    },
  },
  {
    path: ["builds", "get"],
    description: "Show one build",
    usage: "<buildRid>",
    flags: [jsonFlag, ...connectionFlags],
    async run(ctx) {
      const rid = requireRid(ctx, "edro builds get <buildRid>");
      const build = await (await ctx.client()).builds.get(rid);
      if (ctx.json) ctx.deps.io.out(JSON.stringify(build));
      else printBuild(ctx, build);
      return EXIT.ok;
    },
  },
  {
    path: ["builds", "jobs"],
    description: "List a build's jobs",
    usage: "<buildRid>",
    flags: [jsonFlag, ...connectionFlags],
    async run(ctx) {
      const rid = requireRid(ctx, "edro builds jobs <buildRid>");
      const client = await ctx.client();
      const jobs = await collectPages((pageToken) => client.builds.jobs(rid, { pageToken }));
      if (ctx.json) ctx.deps.io.out(JSON.stringify(jobs));
      else for (const line of jobRows(jobs, ctx.deps.io.color)) ctx.deps.io.out(line);
      return EXIT.ok;
    },
  },
  {
    path: ["builds", "watch"],
    description: "Wait for a build to finish; exits 5 if it doesn't succeed",
    usage: "<buildRid>",
    flags: [
      { name: "interval", description: "Seconds between checks (default 5)" },
      jsonFlag,
      ...connectionFlags,
    ],
    async run(ctx) {
      const rid = requireRid(ctx, "edro builds watch <buildRid>");
      const intervalMs = parseLimit(ctx.args.interval, 5) * 1000;
      const client = await ctx.client();
      const { io } = ctx.deps;
      let last: string | undefined;
      let build = await client.builds.get(rid);
      for (;;) {
        if (!ctx.json && build.status !== last) {
          io.out(
            `${new Date(ctx.deps.now()).toISOString()}  ${formatStatus(build.status, io.color)}`,
          );
          last = build.status;
        }
        if (isFinished(build.status)) break;
        await ctx.deps.sleep(intervalMs);
        build = await client.builds.get(rid);
      }
      if (ctx.json) io.out(JSON.stringify(build));
      else io.out(`Build ${build.status} after ${formatDuration(build.durationMs)}.`);
      return build.status === "succeeded" ? EXIT.ok : EXIT.buildFailed;
    },
  },
];
