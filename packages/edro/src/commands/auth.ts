import * as p from "@clack/prompts";
import {
  type AuthType,
  browserLogin,
  type CurrentUser,
  createClient,
  DEFAULT_REDIRECT_PORT,
  DEFAULT_SCOPES,
  loadConfig,
  normalizeHostname,
  type Profile,
  redirectUri,
  SECRET_KEYS,
  type SecretKey,
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
  /** Token or client secret; for browser sign-in, filled in by `signIn`. */
  secret?: string;
}

const AUTH_TYPES: AuthType[] = ["token", "client-credentials", "oauth"];

function parseAuth(value: unknown): AuthType | undefined {
  const auth = str(value);
  if (auth && !AUTH_TYPES.includes(auth as AuthType)) {
    throw new UsageError(`Invalid --auth "${auth}". Use ${AUTH_TYPES.join(", ")}.`);
  }
  return auth as AuthType | undefined;
}

function parsePort(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`Invalid --port "${value}".`);
  }
  return port;
}

const scopesFlag = (ctx: CommandContext) => str(ctx.args.scopes)?.split(",") ?? DEFAULT_SCOPES;

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
  const auth =
    parseAuth(args.auth) ??
    answer(
      await p.select<AuthType>({
        message: "How do you want to authenticate?",
        options: [
          { value: "token", label: "Personal token", hint: "from Developer Console" },
          {
            value: "oauth",
            label: "Sign in with browser",
            hint: "needs an OAuth app with a localhost redirect",
          },
          {
            value: "client-credentials",
            label: "OAuth client credentials",
            hint: "for automation",
          },
        ],
      }),
    );

  if (auth === "token") {
    const secret = answer(
      await p.password({ message: "Token", validate: (v) => (v ? undefined : "Required") }),
    );
    return { name, profile: { hostname, auth }, secret };
  }
  const clientId =
    str(args["client-id"]) ??
    answer(await p.text({ message: "Client ID", validate: (v) => (v ? undefined : "Required") }));
  if (auth === "oauth") {
    const redirectPort = parsePort(args.port) ?? DEFAULT_REDIRECT_PORT;
    return { name, profile: { hostname, auth, clientId, scopes: scopesFlag(ctx), redirectPort } };
  }
  const secret = answer(
    await p.password({ message: "Client secret", validate: (v) => (v ? undefined : "Required") }),
  );
  return { name, profile: { hostname, auth, clientId, scopes: scopesFlag(ctx) }, secret };
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

/** Browser sign-in with everything given as flags: no prompts needed. */
function flagOAuthLogin(ctx: CommandContext): LoginInput | undefined {
  const hostname = str(ctx.args.hostname);
  const clientId = str(ctx.args["client-id"]);
  if (parseAuth(ctx.args.auth) !== "oauth" || !hostname || !clientId) return undefined;
  return {
    name: str(ctx.args.profile) ?? "default",
    profile: {
      hostname: normalizeHostname(hostname),
      auth: "oauth",
      clientId,
      scopes: scopesFlag(ctx),
      redirectPort: parsePort(ctx.args.port) ?? DEFAULT_REDIRECT_PORT,
    },
  };
}

/** Checks the credentials (signing in through the browser first, for oauth). */
async function signIn(
  ctx: CommandContext,
  input: LoginInput,
  say: (line: string) => void,
): Promise<{ user: CurrentUser; secretKey: SecretKey; secret: string }> {
  const { profile } = input;
  const { fetch } = ctx.deps;
  if (profile.auth === "oauth") {
    const port = profile.redirectPort ?? DEFAULT_REDIRECT_PORT;
    say(`The OAuth app's redirect URL must be ${redirectUri(port)}`);
    const tokens = await browserLogin({
      hostname: profile.hostname,
      clientId: profile.clientId as string,
      scopes: profile.scopes ?? DEFAULT_SCOPES,
      port,
      openUrl: ctx.deps.openUrl,
      onUrl: (url) => say(`Opening your browser to sign in. If it doesn't open, visit:\n${url}`),
      fetch,
    });
    const user = await createClient({
      hostname: profile.hostname,
      tokenProvider: async () => tokens.accessToken,
      fetch,
    }).whoami();
    if (!tokens.refreshToken) {
      say(
        "Foundry didn't issue a refresh token, so you'll need to log in again when this session expires.",
      );
    }
    return tokens.refreshToken
      ? { user, secretKey: "refresh_token", secret: tokens.refreshToken }
      : { user, secretKey: "token", secret: tokens.accessToken };
  }
  const secret = input.secret as string;
  const user = await createClient({
    hostname: profile.hostname,
    tokenProvider: tokenProviderFor(profile, secret, fetch),
    fetch,
  }).whoami();
  return { user, secretKey: profile.auth === "token" ? "token" : "client_secret", secret };
}

async function deleteSecrets(ctx: { deps: CommandContext["deps"] }, name: string): Promise<void> {
  for (const key of SECRET_KEYS) await ctx.deps.secrets.delete(name, key);
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
        description: "token, oauth (browser sign-in) or client-credentials",
        values: AUTH_TYPES,
      },
      { name: "client-id", description: "OAuth client ID (oauth, client-credentials)" },
      { name: "scopes", description: "Comma-separated OAuth scopes" },
      {
        name: "port",
        description: `Local port for the browser sign-in redirect (default ${DEFAULT_REDIRECT_PORT})`,
      },
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
      const fromFlags = withToken ? undefined : flagOAuthLogin(ctx);
      const interactive = !withToken && !fromFlags;
      if (interactive && !deps.interactive) {
        throw new UsageError(
          "`edro login` needs a terminal. In scripts, pipe a token in (edro login --hostname <host> --with-token), or pass --auth oauth with --hostname and --client-id.",
        );
      }
      const input = withToken
        ? await stdinLogin(ctx)
        : (fromFlags ?? (await promptLogin(ctx, config.defaultProfile)));
      const invalid = validateProfileName(input.name);
      if (invalid) throw new UsageError(`Invalid profile name "${input.name}". ${invalid}`);

      const say = interactive
        ? (line: string) => p.log.info(line)
        : (line: string) => deps.io.err(line);
      const spinner = interactive && input.profile.auth !== "oauth" ? p.spinner() : undefined;
      spinner?.start(`Checking credentials with ${input.profile.hostname}`);
      let result: Awaited<ReturnType<typeof signIn>>;
      try {
        result = await signIn(ctx, input, say);
      } catch (e) {
        spinner?.error("Could not sign in");
        throw e;
      }
      spinner?.stop(`Signed in as ${result.user.username}`);

      // Replace whatever this profile stored before, e.g. after switching auth type.
      await deleteSecrets(ctx, input.name);
      await deps.secrets.set(input.name, result.secretKey, result.secret);
      config.profiles[input.name] = input.profile;
      config.defaultProfile ??= input.name;
      saveConfig(deps.configDir, config);

      const msg = `Logged in to ${input.profile.hostname} as ${result.user.username} (profile "${input.name}"${config.defaultProfile === input.name ? ", default" : ""}).`;
      if (interactive) p.outro(msg);
      else deps.io.out(msg);
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
      await deleteSecrets({ deps }, name);
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
      await deleteSecrets({ deps }, name);
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
