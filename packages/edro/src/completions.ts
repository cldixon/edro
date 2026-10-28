import t from "@bomb.sh/tab";
import { type CommandDef, globalFlags } from "./commands/index.ts";
import type { Io } from "./io.ts";

/**
 * Handles `edro complete <shell>` (prints the shell script) and
 * `edro complete -- <words...>` (answers a completion request).
 */
export function runCompletions(commands: CommandDef[], argv: string[], io: Io): number {
  for (const flag of globalFlags) t.option(flag.name, flag.description);
  // tab resolves `builds ls` word by word, so each group needs its own entry.
  const groups = new Set(commands.filter((c) => c.path.length > 1).map((c) => c.path[0] as string));
  for (const group of groups) t.command(group, `${group} commands`);
  for (const cmd of commands) {
    const tabCmd = t.command(cmd.path.join(" "), cmd.description);
    for (const flag of cmd.flags ?? []) {
      const values = flag.values;
      if (values) {
        tabCmd.option(flag.name, flag.description, (complete) => {
          for (const v of values) complete(v, "");
        });
      } else {
        tabCmd.option(flag.name, flag.description);
      }
    }
  }

  const [shell, ...words] = argv;
  if (shell === "--") {
    t.parse(words);
  } else if (shell) {
    t.setup("edro", "edro", shell);
  } else {
    io.err("Usage: edro complete <zsh|bash|fish|powershell>");
    return 2;
  }
  return 0;
}
