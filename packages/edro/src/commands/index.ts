import { authCommands } from "./auth.ts";
import { buildCommands } from "./builds.ts";
import { miscCommands } from "./misc.ts";
import { scheduleCommands } from "./schedules.ts";
import type { CommandDef, Flag } from "./types.ts";

export type { CommandDef, Flag } from "./types.ts";

export const commands: CommandDef[] = [
  ...buildCommands,
  ...scheduleCommands,
  ...miscCommands,
  ...authCommands,
];

export const globalFlags: Flag[] = [
  { name: "help", description: "Show help", boolean: true, alias: "h" },
  { name: "version", description: "Show the edro version", boolean: true, alias: "v" },
];
