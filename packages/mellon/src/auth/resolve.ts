import { createConfidentialOauthClient } from "@osdk/oauth";
import { EdroError } from "../errors.ts";
import { type AuthType, type Config, normalizeHostname, type Profile } from "./config.ts";
import type { SecretStore } from "./secrets.ts";

export const DEFAULT_SCOPES = ["api:orchestration-read", "api:admin-read"];

export interface Connection {
  hostname: string;
  auth: AuthType;
  /** The profile used, or null when everything came from the environment. */
  profile: string | null;
  /** Where the credentials came from, for `edro whoami`. */
  source: "env" | "profile";
  tokenProvider: () => Promise<string>;
}

export interface ResolveInput {
  flags: { profile?: string; hostname?: string };
  env: Record<string, string | undefined>;
  config: Config;
  secrets: SecretStore;
  fetch?: typeof globalThis.fetch;
}

/** Same environment variable names as Foundry's Python SDK. */
export const ENV = {
  hostname: "FOUNDRY_HOSTNAME",
  token: "FOUNDRY_TOKEN",
  clientId: "FOUNDRY_CLIENT_ID",
  clientSecret: "FOUNDRY_CLIENT_SECRET",
  profile: "EDRO_PROFILE",
} as const;

function clientCredentials(
  hostname: string,
  clientId: string,
  secret: string,
  scopes: string[],
  fetchFn?: typeof globalThis.fetch,
): () => Promise<string> {
  // Handles fetching and refreshing the token.
  return createConfidentialOauthClient(clientId, secret, `https://${hostname}`, scopes, fetchFn);
}

/** A token provider for a profile and its secret, e.g. to check credentials before saving them. */
export function tokenProviderFor(
  profile: Profile,
  secret: string,
  fetchFn?: typeof globalThis.fetch,
): () => Promise<string> {
  if (profile.auth === "token") return async () => secret;
  if (!profile.clientId)
    throw new EdroError("Client-credentials auth needs a client ID.", "config");
  return clientCredentials(
    profile.hostname,
    profile.clientId,
    secret,
    profile.scopes ?? DEFAULT_SCOPES,
    fetchFn,
  );
}

/**
 * Works out which host and credentials to use.
 *
 * - An explicit `--profile` uses that profile (with `--hostname` still able to override the host).
 * - Otherwise `--hostname`, then the FOUNDRY_* environment variables, then the
 *   active profile (EDRO_PROFILE, else the default) fill in what's missing.
 */
export async function resolveConnection(input: ResolveInput): Promise<Connection> {
  const { flags, env, config, secrets } = input;
  const profileName = flags.profile ?? env[ENV.profile] ?? config.defaultProfile;
  const profile = profileName ? config.profiles[profileName] : undefined;
  if ((flags.profile || env[ENV.profile]) && !profile) {
    throw new EdroError(
      `No profile named "${profileName}".`,
      "config",
      "Run `edro profiles ls` to see your profiles, or `edro login` to create one.",
    );
  }

  const useEnv = !flags.profile;
  const rawHost = flags.hostname ?? (useEnv ? env[ENV.hostname] : undefined) ?? profile?.hostname;
  if (!rawHost) {
    throw new EdroError(
      "No Foundry host configured.",
      "config",
      `Run \`edro login\`, or set ${ENV.hostname} and ${ENV.token}.`,
    );
  }
  const hostname = normalizeHostname(rawHost);

  const envToken = env[ENV.token];
  const envClientId = env[ENV.clientId];
  const envClientSecret = env[ENV.clientSecret];
  if (useEnv && envToken) {
    const token = envToken;
    return {
      hostname,
      auth: "token",
      profile: null,
      source: "env",
      tokenProvider: async () => token,
    };
  }
  if (useEnv && envClientId && envClientSecret) {
    return {
      hostname,
      auth: "client-credentials",
      profile: null,
      source: "env",
      tokenProvider: clientCredentials(
        hostname,
        envClientId,
        envClientSecret,
        DEFAULT_SCOPES,
        input.fetch,
      ),
    };
  }

  if (profile && profileName) {
    const missing = new EdroError(
      `No stored credentials for profile "${profileName}".`,
      "auth",
      `Run \`edro login --profile ${profileName}\`, or set ${ENV.token}.`,
    );
    if (profile.auth === "client-credentials") {
      const secret = await secrets.get(profileName, "client_secret");
      if (!secret || !profile.clientId) throw missing;
      return {
        hostname,
        auth: "client-credentials",
        profile: profileName,
        source: "profile",
        tokenProvider: clientCredentials(
          hostname,
          profile.clientId,
          secret,
          profile.scopes ?? DEFAULT_SCOPES,
          input.fetch,
        ),
      };
    }
    const token = await secrets.get(profileName, "token");
    if (!token) throw missing;
    return {
      hostname,
      auth: "token",
      profile: profileName,
      source: "profile",
      tokenProvider: async () => token,
    };
  }

  throw new EdroError(
    `No credentials for ${hostname}.`,
    "auth",
    `Run \`edro login\`, or set ${ENV.token}.`,
  );
}
