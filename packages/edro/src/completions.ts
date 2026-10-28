import t from "@bomb.sh/tab";
import { type CommandDef, globalFlags } from "./commands.ts";

/**
 * Handles `edro complete <shell>` (prints the shell script) and
 * `edro complete -- <words...>` (answers a completion request).
 */
export function runCompletions(commands: CommandDef[], argv: string[]): number {
  for (const flag of globalFlags) t.option(flag.name, flag.description);
  for (const cmd of commands) {
    const tabCmd = t.command(cmd.path.join(" "), cmd.description);
    for (const flag of cmd.flags ?? []) tabCmd.option(flag.name, flag.description);
  }

  const [shell, ...words] = argv;
  if (shell === "--") {
    t.parse(words);
  } else if (shell) {
    t.setup("edro", "edro", shell);
  } else {
    return 1;
  }
  return 0;
}
