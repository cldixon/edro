import type { CommandContext } from "../context.ts";

export interface Flag {
  name: string;
  description: string;
  /** Flags are strings unless marked boolean. */
  boolean?: boolean;
  alias?: string;
  /** Shell-completion suggestions for the flag's value. */
  values?: string[];
}

export interface CommandDef {
  /** Path of words, so nested commands like ["builds", "ls"] work the same way. */
  path: string[];
  description: string;
  /** Positional arguments, for help text, e.g. "<buildRid>". */
  usage?: string;
  flags?: Flag[];
  run(ctx: CommandContext): Promise<number> | number;
}

export const jsonFlag: Flag = {
  name: "json",
  description: "Print machine-readable JSON",
  boolean: true,
};
export const demoFlag: Flag = {
  name: "demo",
  description: "Use made-up demo data (no credentials needed)",
  boolean: true,
};
export const connectionFlags: Flag[] = [
  { name: "profile", description: "Profile to use" },
  { name: "hostname", description: "Foundry host, overriding the profile" },
  demoFlag,
];
export const allUsersFlag: Flag = {
  name: "all-users",
  description: "Include everyone's builds, not just yours (slower on busy instances)",
  boolean: true,
};
