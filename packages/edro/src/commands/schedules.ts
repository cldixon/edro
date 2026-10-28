import { collectPages, type Schedule } from "@edro/mellon";
import { EXIT, UsageError } from "../exit.ts";
import { formatAgo, parseSince, table } from "../format.ts";
import { parseLimit } from "./builds.ts";
import { type CommandDef, connectionFlags, jsonFlag } from "./types.ts";

export const scheduleCommands: CommandDef[] = [
  {
    path: ["schedules", "ls"],
    // The public API can't list schedules, so this finds them through builds.
    description: "List schedules that started builds recently",
    flags: [
      { name: "since", description: "Look at builds since, e.g. 2d (default 7d)" },
      jsonFlag,
      ...connectionFlags,
    ],
    async run(ctx) {
      const { args, deps } = ctx;
      const client = await ctx.client();
      const since = typeof args.since === "string" ? parseSince(args.since, deps.now()) : undefined;
      const builds = await collectPages(
        (pageToken) => client.builds.search({ since, pageSize: 100, pageToken }),
        1000,
      );
      const lastBuild = new Map<string, (typeof builds)[number]>();
      for (const b of builds)
        if (b.scheduleRid && !lastBuild.has(b.scheduleRid)) lastBuild.set(b.scheduleRid, b);
      const schedules: Schedule[] = await Promise.all(
        [...lastBuild.keys()].map((rid) => client.schedules.get(rid)),
      );
      const rows = schedules.map((s) => ({
        ...s,
        lastBuild: {
          rid: lastBuild.get(s.rid)?.rid,
          status: lastBuild.get(s.rid)?.status,
          startedAt: lastBuild.get(s.rid)?.createdAt,
        },
      }));
      if (ctx.json) {
        deps.io.out(JSON.stringify(rows));
      } else if (rows.length === 0) {
        deps.io.out("No schedules started builds in this period.");
      } else {
        const lines = table(
          ["name", "paused", "last build", "rid"],
          rows.map((r) => [
            r.name ?? "(unnamed)",
            r.paused ? "yes" : "",
            r.lastBuild.status && r.lastBuild.startedAt
              ? `${r.lastBuild.status}, ${formatAgo(r.lastBuild.startedAt, deps.now())}`
              : "",
            r.rid,
          ]),
        );
        for (const line of lines) deps.io.out(line);
      }
      return EXIT.ok;
    },
  },
  {
    path: ["schedules", "runs"],
    description: "List a schedule's recent runs",
    usage: "<scheduleRid>",
    flags: [
      { name: "limit", description: "Maximum runs to show (default 20)" },
      { name: "all", description: "Fetch every run", boolean: true },
      jsonFlag,
      ...connectionFlags,
    ],
    async run(ctx) {
      const [rid] = ctx.rest;
      if (!rid) throw new UsageError("Usage: edro schedules runs <scheduleRid>");
      const limit = ctx.args.all ? Number.POSITIVE_INFINITY : parseLimit(ctx.args.limit, 20);
      const client = await ctx.client();
      const runs = await collectPages(
        (pageToken) => client.schedules.runs(rid, { pageSize: Math.min(limit, 100), pageToken }),
        limit,
      );
      if (ctx.json) {
        ctx.deps.io.out(JSON.stringify(runs));
      } else {
        const lines = table(
          ["created", "result", "build"],
          runs.map((r) => [
            formatAgo(r.createdAt, ctx.deps.now()),
            r.result.type === "error" ? `error: ${r.result.errorName}` : r.result.type,
            r.result.type === "submitted" ? r.result.buildRid : "",
          ]),
        );
        for (const line of lines) ctx.deps.io.out(line);
      }
      return EXIT.ok;
    },
  },
];
