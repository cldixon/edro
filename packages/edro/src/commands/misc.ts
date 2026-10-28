import { webUrl } from "@edro/mellon";
import { EXIT, UsageError } from "../exit.ts";
import { type CommandDef, connectionFlags } from "./types.ts";

export const miscCommands: CommandDef[] = [
  {
    path: ["open"],
    description: "Open a resource (build, dataset, ...) in the Foundry web UI",
    usage: "<rid>",
    flags: [
      { name: "print", description: "Print the URL instead of opening it", boolean: true },
      ...connectionFlags,
    ],
    async run(ctx) {
      const [rid] = ctx.rest;
      if (!rid) throw new UsageError("Usage: edro open <rid>");
      const hostname = ctx.args.demo
        ? (await ctx.client()).hostname
        : (await ctx.connection()).hostname;
      const url = webUrl(hostname, rid);
      if (ctx.args.print) ctx.deps.io.out(url);
      else await ctx.deps.openUrl(url);
      return EXIT.ok;
    },
  },
  {
    path: ["ui"],
    description: "Open the terminal UI with a live build list",
    flags: [
      { name: "interval", description: "Seconds between refreshes (default 10)" },
      ...connectionFlags,
    ],
    async run(ctx) {
      const client = await ctx.client();
      const interval = Number(ctx.args.interval ?? 10);
      // Loaded lazily so plain CLI commands don't pay for the native renderer.
      const { runTui } = await import("@edro/tui");
      await runTui({
        client,
        openUrl: ctx.deps.openUrl,
        intervalMs: Number.isFinite(interval) && interval > 0 ? interval * 1000 : 10_000,
      });
      return EXIT.ok;
    },
  },
];
