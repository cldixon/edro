import { parse } from "@bomb.sh/args";
import pkg from "../package.json" with { type: "json" };
import { type CommandDef, commands, globalFlags } from "./commands.ts";
import { runCompletions } from "./completions.ts";
import { type Io, processIo } from "./io.ts";

/** Picks the command whose path matches the longest prefix of the positionals. */
export function findCommand(
  positionals: string[],
  defs: CommandDef[] = commands,
): { command: CommandDef; rest: string[] } | undefined {
  let best: CommandDef | undefined;
  for (const def of defs) {
    const matches = def.path.every((word, i) => positionals[i] === word);
    if (matches && def.path.length > (best?.path.length ?? 0)) best = def;
  }
  return best && { command: best, rest: positionals.slice(best.path.length) };
}

export function helpText(): string {
  const width = Math.max(...commands.map((c) => c.path.join(" ").length), "complete".length);
  const lines = [
    `edro ${pkg.version}: an unofficial CLI and TUI for Foundry`,
    "",
    "Usage: edro <command> [flags]",
    "",
    "Commands:",
    ...commands.map((c) => `  ${c.path.join(" ").padEnd(width)}  ${c.description}`),
    `  ${"complete".padEnd(width)}  Print shell completions (zsh, bash, fish, powershell)`,
    "",
    "Flags:",
    "  --help       Show help",
    "  --version    Show the edro version",
    "  --json       Print machine-readable JSON (data commands)",
  ];
  return lines.join("\n");
}

export async function main(argv: string[], io: Io = processIo): Promise<number> {
  // Completion requests pass raw words through untouched.
  if (argv[0] === "complete") return runCompletions(commands, argv.slice(1));

  const booleans = [...globalFlags, ...commands.flatMap((c) => c.flags ?? [])]
    .filter((f) => f.boolean)
    .map((f) => f.name);
  const args = parse(argv, { boolean: booleans, alias: { h: "help", v: "version" } });
  const positionals = args._.map(String);

  if (args.version) {
    io.out(pkg.version);
    return 0;
  }
  if (positionals.length === 0 || args.help) {
    io.out(helpText());
    return 0;
  }

  const match = findCommand(positionals);
  if (!match) {
    io.err(`edro: unknown command "${positionals.join(" ")}". Run \`edro --help\`.`);
    return 1;
  }
  return match.command.run({ args, io, rest: match.rest });
}
