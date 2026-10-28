import type { Args } from "@bomb.sh/args";
import {
  type Connection,
  configDir,
  createClient,
  createDemoClient,
  keychainStore,
  loadConfig,
  type MellonClient,
  resolveConnection,
  type SecretStore,
} from "@edro/mellon";
import type { Io } from "./io.ts";
import { processIo } from "./io.ts";

/** Everything a command touches outside itself, so tests can swap it out. */
export interface Deps {
  io: Io;
  env: Record<string, string | undefined>;
  configDir: string;
  secrets: SecretStore;
  /** Network access to Foundry. Tests pass a fake. */
  fetch?: typeof globalThis.fetch;
  /** Whether prompts can be shown (stdin and stdout are terminals). */
  interactive: boolean;
  readStdin(): Promise<string>;
  openUrl(url: string): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export function defaultDeps(): Deps {
  return {
    io: processIo,
    env: process.env,
    configDir: configDir(),
    secrets: keychainStore(),
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    readStdin: () => Bun.stdin.text(),
    openUrl,
    now: Date.now,
    sleep: (ms) => Bun.sleep(ms),
  };
}

async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

export interface CommandContext {
  args: Args;
  /** Positionals after the command path, e.g. the RID in `edro builds get <rid>`. */
  rest: string[];
  deps: Deps;
  json: boolean;
  /** The resolved connection (not available in demo mode). */
  connection(): Promise<Connection>;
  /** A client for the configured Foundry host, or demo data with `--demo`. */
  client(): Promise<MellonClient>;
}

export function createContext(args: Args, rest: string[], deps: Deps): CommandContext {
  let conn: Promise<Connection> | undefined;
  let client: Promise<MellonClient> | undefined;
  const connection = () => {
    conn ??= resolveConnection({
      flags: {
        profile: typeof args.profile === "string" ? args.profile : undefined,
        hostname: typeof args.hostname === "string" ? args.hostname : undefined,
      },
      env: deps.env,
      config: loadConfig(deps.configDir),
      secrets: deps.secrets,
      fetch: deps.fetch,
    });
    return conn;
  };
  return {
    args,
    rest,
    deps,
    json: !!args.json,
    connection,
    client() {
      client ??= args.demo
        ? Promise.resolve(createDemoClient(deps.now))
        : connection().then((c) =>
            createClient({
              hostname: c.hostname,
              tokenProvider: c.tokenProvider,
              fetch: deps.fetch,
              now: deps.now,
            }),
          );
      return client;
    },
  };
}
