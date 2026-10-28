import { parse } from "@bomb.sh/args";
import { EdroError, toEdroError } from "@edro/mellon";
import pkg from "../package.json" with { type: "json" };
import { type CommandDef, commands, type Flag, globalFlags } from "./commands/index.ts";
import { runCompletions } from "./completions.ts";
import { createContext, type Deps, defaultDeps } from "./context.ts";
import { EXIT, exitCodeFor, UsageError } from "./exit.ts";

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

function columns(rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([a]) => a.length));
  return rows.map(([a, b]) => `  ${a.padEnd(width)}  ${b}`);
}

export function helpText(defs: CommandDef[] = commands, title?: string): string {
  return [
    title ?? `edro ${pkg.version}: an unofficial CLI and TUI for Foundry`,
    "",
    "Usage: edro <command> [flags]",
    "",
    "Commands:",
    ...columns([
      ...defs.map((c): [string, string] => [
        [...c.path, c.usage].filter(Boolean).join(" "),
        c.description,
      ]),
      ...(title
        ? []
        : [
            ["complete <shell>", "Print shell completions (zsh, bash, fish, powershell)"] as [
              string,
              string,
            ],
          ]),
    ]),
    "",
    "Run `edro <command> --help` for a command's flags.",
  ].join("\n");
}

function flagLabel(f: Flag): string {
  return `${f.alias ? `-${f.alias}, ` : ""}--${f.name}${f.boolean ? "" : " <value>"}`;
}

export function commandHelp(def: CommandDef): string {
  return [
    def.description,
    "",
    `Usage: edro ${[...def.path, def.usage].filter(Boolean).join(" ")} [flags]`,
    ...(def.flags?.length
      ? ["", "Flags:", ...columns(def.flags.map((f) => [flagLabel(f), f.description]))]
      : []),
  ].join("\n");
}

function printError(e: unknown, deps: Deps, json: boolean): number {
  if (e instanceof UsageError) {
    if (json) deps.io.err(JSON.stringify({ error: { kind: "usage", message: e.message } }));
    else deps.io.err(`error: ${e.message}`);
    return EXIT.usage;
  }
  const err = e instanceof EdroError ? e : toEdroError(e);
  if (json) {
    deps.io.err(JSON.stringify({ error: err.toJSON() }));
  } else {
    deps.io.err(`error: ${err.message}`);
    if (err.hint) deps.io.err(`hint: ${err.hint}`);
  }
  return exitCodeFor(err);
}

export async function main(argv: string[], deps: Deps = defaultDeps()): Promise<number> {
  // Completion requests pass raw words through untouched.
  if (argv[0] === "complete") return runCompletions(commands, argv.slice(1), deps.io);

  const allFlags = [...globalFlags, ...commands.flatMap((c) => c.flags ?? [])];
  const args = parse(argv, {
    boolean: [...new Set(allFlags.filter((f) => f.boolean).map((f) => f.name))],
    string: [...new Set(allFlags.filter((f) => !f.boolean).map((f) => f.name))],
    alias: { h: "help", v: "version" },
  });
  const positionals = args._.map(String);
  const json = !!args.json;

  if (args.version) {
    deps.io.out(pkg.version);
    return EXIT.ok;
  }
  if (positionals.length === 0) {
    deps.io.out(helpText());
    return EXIT.ok;
  }

  const match = findCommand(positionals);
  if (!match) {
    // `edro builds` on its own: show that group's commands.
    const group = commands.filter((c) => c.path[0] === positionals[0] && c.path.length > 1);
    if (group.length && positionals.length === 1) {
      deps.io.out(helpText(group, `edro ${positionals[0]}`));
      return args.help ? EXIT.ok : EXIT.usage;
    }
    deps.io.err(`error: unknown command "${positionals.join(" ")}". Run \`edro --help\`.`);
    return EXIT.usage;
  }
  if (args.help) {
    deps.io.out(commandHelp(match.command));
    return EXIT.ok;
  }

  try {
    return await match.command.run(createContext(args, match.rest, deps));
  } catch (e) {
    return printError(e, deps, json);
  }
}
