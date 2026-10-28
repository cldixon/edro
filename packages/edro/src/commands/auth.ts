import * as p from "@clack/prompts";
import {
  type AuthType,
  type CurrentUser,
  createClient,
  DEFAULT_SCOPES,
  loadConfig,
  normalizeHostname,
  type Profile,
  saveConfig,
  tokenProviderFor,
  validateProfileName,
} from "@edro/mellon";
import type { CommandContext } from "../context.ts";
import { EXIT, UsageError } from "../exit.ts";
import { table } from "../format.ts";
import { type CommandDef, connectionFlags, jsonFlag } from "./types.ts";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Unwraps a Clack answer, turning Ctrl+C into a quiet exit. */
function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Login cancelled.");
    process.exit(EXIT.error);
  }
  return value as Exclude<T, symbol>;
}

interface LoginInput {
  name: string;
  profile: Profile;
  secret: string;
}

async function promptLogin(
  ctx: CommandContext,
  existingDefault: string | null,
): Promise<LoginInput> {
  const { args } = ctx;
  p.intro("edro login");
  const name =
    str(args.profile) ??
    answer(
      await p.text({
        message: "Profile name",
        defaultValue: existingDefault ?? "default",
        placeholder: existingDefault ?? "default",
        validate: (v) => (v ? validateProfileName(v) : undefined),
      }),
    );
  const hostname = normalizeHostname(
    str(args.hostname) ??
      answer(
        await p.text({
          message: "Foundry hostname",
          placeholder: "example.palantirfoundry.com",
          validate: (v) => (v?.trim() ? undefined : "Required"),
        }),
      ),
  );
  const auth = (str(args.auth) ??
    answer(
      await p.select({
        message: "How do you want to authenticate?",
        options: [
          { value: "token", label: "Personal token", hint: "from Developer Console" },
          {
            value: "client-credentials",
            label: "OAuth client credentials",
            hint: "for automation",
          },
        ],
      }),
    )) as AuthType;

  if (auth === "token") {
    const secret = answer(
      await p.password({ message: "Token", validate: (v) => (v ? undefined : "Required") }),
    );
    return { name, profile: { hostname, auth }, secret };
  }
  const clientId =
    str(args["client-id"]) ??
    answer(await p.text({ message: "Client ID", validate: (v) => (v ? undefined : "Required") }));
  const secret = answer(
    await p.password({ message: "Client secret", validate: (v) => (v ? undefined : "Required") }),
  );
  const scopes = str(args.scopes)?.split(",") ?? DEFAULT_SCOPES;
  return { name, profile: { hostname, auth, clientId, scopes }, secret };
}

/** `--with-token`: non-interactive token login, reading the token from stdin. */
async function stdinLogin(ctx: CommandContext): Promise<LoginInput> {
  const hostname = str(ctx.args.hostname);
  if (!hostname) throw new UsageError("--with-token needs --hostname.");
  const secret = (await ctx.deps.readStdin()).trim();
  if (!secret) throw new UsageError("--with-token expects a token on stdin.");
  return {
    name: str(ctx.args.profile) ?? "default",
    profile: { hostname: normalizeHostname(hostname), auth: "token" },
    secret,
  };
}

function verify(ctx: CommandContext, input: LoginInput): Promise<CurrentUser> {
  const tokenProvider = tokenProviderFor(input.profile, input.secret, ctx.deps.fetch);
  return createClient({
    hostname: input.profile.hostname,
    tokenProvider,
    fetch: ctx.deps.fetch,
  }).whoami();
}

export const authCommands: CommandDef[] = [
  {
    path: ["login"],
    description: "Sign in to a Foundry host and save it as a profile",
    flags: [
      { name: "profile", description: "Profile name (default: default)" },
      { name: "hostname", description: "Foundry host, e.g. example.palantirfoundry.com" },
      {
        name: "auth",
        description: "token or client-credentials",
        values: ["token", "client-credentials"],
      },
      { name: "client-id", description: "OAuth client ID (client-credentials)" },
      { name: "scopes", description: "Comma-separated OAuth scopes (client-credentials)" },
      {
        name: "with-token",
        description: "Read a token from stdin instead of prompting",
        boolean: true,
      },
    ],
    async run(ctx) {
      const { deps } = ctx;
      const config = loadConfig(deps.configDir);
      const withToken = !!ctx.args["with-token"];
      if (!withToken && !deps.interactive) {
        throw new UsageError(
          "`edro login` needs a terminal. In scripts, pipe a token in: edro login --hostname <host> --with-token",
        );
      }
      const input = withToken
        ? await stdinLogin(ctx)
        : await promptLogin(ctx, config.defaultProfile);
      const invalid = validateProfileName(input.name);
      if (invalid) throw new UsageError(`Invalid profile name "${input.name}". ${invalid}`);

      const spinner = withToken ? undefined : p.spinner();
      spinner?.start(`Checking credentials with ${input.profile.hostname}`);
      let user: CurrentUser;
      try {
        user = await verify(ctx, input);
      } catch (e) {
        spinner?.error("Could not sign in");
        throw e;
      }
      spinner?.stop(`Signed in as ${user.username}`);

      await deps.secrets.set(
        input.name,
        input.profile.auth === "token" ? "token" : "client_secret",
        input.secret,
      );
      config.profiles[input.name] = input.profile;
      config.defaultProfile ??= input.name;
      saveConfig(deps.configDir, config);

      const msg = `Logged in to ${input.profile.hostname} as ${user.username} (profile "${input.name}"${config.defaultProfile === input.name ? ", default" : ""}).`;
      if (withToken) deps.io.out(msg);
      else p.outro(msg);
      return EXIT.ok;
    },
  },
  {
    path: ["logout"],
    description: "Remove a profile's stored credentials",
    flags: [
      { name: "profile", description: "Profile to log out of (default: the default profile)" },
    ],
    async run({ args, deps }) {
      const config = loadConfig(deps.configDir);
      const name = str(args.profile) ?? config.defaultProfile;
      if (!name || !config.profiles[name])
        throw new UsageError(`No profile named "${name ?? ""}".`);
      await deps.secrets.delete(name, "token");
      await deps.secrets.delete(name, "client_secret");
      deps.io.out(`Removed stored credentials for profile "${name}".`);
      return EXIT.ok;
    },
  },
  {
    path: ["profiles", "ls"],
    description: "List profiles",
    flags: [jsonFlag],
    run({ deps, json }) {
      const config = loadConfig(deps.configDir);
      const rows = Object.entries(config.profiles).map(([name, p]) => ({
        name,
        hostname: p.hostname,
        auth: p.auth,
        default: name === config.defaultProfile,
      }));
      if (json) {
        deps.io.out(JSON.stringify(rows));
      } else if (rows.length === 0) {
        deps.io.out("No profiles yet. Run `edro login` to create one.");
      } else {
        for (const line of table(
          ["", "name", "hostname", "auth"],
          rows.map((r) => [r.default ? "*" : "", r.name, r.hostname, r.auth]),
        )) {
          deps.io.out(line);
        }
      }
      return EXIT.ok;
    },
  },
  {
    path: ["profiles", "use"],
    description: "Set the default profile",
    usage: "<name>",
    run({ rest, deps }) {
      const [name] = rest;
      if (!name) throw new UsageError("Usage: edro profiles use <name>");
      const config = loadConfig(deps.configDir);
      if (!config.profiles[name]) throw new UsageError(`No profile named "${name}".`);
      config.defaultProfile = name;
      saveConfig(deps.configDir, config);
      deps.io.out(`Default profile is now "${name}".`);
      return EXIT.ok;
    },
  },
  {
    path: ["profiles", "rm"],
    description: "Delete a profile and its stored credentials",
    usage: "<name>",
    async run({ rest, deps }) {
      const [name] = rest;
      if (!name) throw new UsageError("Usage: edro profiles rm <name>");
      const config = loadConfig(deps.configDir);
      if (!config.profiles[name]) throw new UsageError(`No profile named "${name}".`);
      delete config.profiles[name];
      if (config.defaultProfile === name)
        config.defaultProfile = Object.keys(config.profiles)[0] ?? null;
      saveConfig(deps.configDir, config);
      await deps.secrets.delete(name, "token");
      await deps.secrets.delete(name, "client_secret");
      deps.io.out(`Deleted profile "${name}".`);
      return EXIT.ok;
    },
  },
  {
    path: ["whoami"],
    description: "Show the signed-in Foundry user",
    flags: [jsonFlag, ...connectionFlags],
    async run(ctx) {
      const client = await ctx.client();
      const user = await client.whoami();
      const conn = ctx.args.demo ? null : await ctx.connection();
      const result = {
        hostname: client.hostname,
        profile: conn?.profile ?? null,
        auth: conn
          ? `${conn.auth} (${conn.source === "env" ? "environment" : "keychain"})`
          : "demo",
        user,
      };
      if (ctx.json) {
        ctx.deps.io.out(JSON.stringify(result));
      } else {
        const name = user.name ? ` (${user.name})` : "";
        ctx.deps.io.out(`${user.username}${name} on ${result.hostname}`);
        ctx.deps.io.out(`profile: ${result.profile ?? "(none)"}  auth: ${result.auth}`);
      }
      return EXIT.ok;
    },
  },
];
