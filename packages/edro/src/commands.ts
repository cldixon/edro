import type { Args } from "@bomb.sh/args";
import { createClient } from "@edro/mellon";
import type { Io } from "./io.ts";

export interface Flag {
  name: string;
  description: string;
  boolean?: boolean;
}

export interface CommandContext {
  args: Args;
  io: Io;
  /** Positionals left after the command path, e.g. the RID in `edro builds get <rid>`. */
  rest: string[];
}

export interface CommandDef {
  /** Path of words, so nested commands like ["builds", "ls"] work the same way. */
  path: string[];
  description: string;
  flags?: Flag[];
  run(ctx: CommandContext): Promise<number> | number;
}

export const globalFlags: Flag[] = [
  { name: "help", description: "Show help", boolean: true },
  { name: "version", description: "Show the edro version", boolean: true },
];

const json: Flag = { name: "json", description: "Print machine-readable JSON", boolean: true };

export const commands: CommandDef[] = [
  {
    path: ["whoami"],
    description: "Show the current Foundry user (placeholder)",
    flags: [json],
    run({ args, io }) {
      // Real auth and the get-current-user call arrive with profiles (#4).
      const hostname = process.env.FOUNDRY_HOSTNAME ?? null;
      const client = hostname ? createClient({ name: "env", hostname }) : null;
      const result = { hostname: client?.profile.hostname ?? null, user: null };
      if (args.json) {
        io.out(JSON.stringify(result));
      } else {
        io.out(`host: ${result.hostname ?? "(not configured)"}`);
        io.out("user: (not signed in; authentication is not implemented yet)");
      }
      return 0;
    },
  },
  {
    path: ["ui"],
    description: "Open the terminal UI",
    async run() {
      // Loaded lazily so plain CLI commands don't pay for the native renderer.
      const { runTui } = await import("@edro/tui");
      await runTui();
      return 0;
    },
  },
];
