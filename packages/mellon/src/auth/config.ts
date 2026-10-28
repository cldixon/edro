import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EdroError } from "../errors.ts";

// Profiles live in ~/.config/edro/config.toml (or $XDG_CONFIG_HOME/edro).
// This file never holds secrets; those go to the OS keychain.

export type AuthType = "token" | "client-credentials" | "oauth";

export interface Profile {
  hostname: string;
  auth: AuthType;
  /** OAuth client ID, for client-credentials and browser (oauth) auth. Not a secret. */
  clientId?: string;
  scopes?: string[];
  /** Local port for the browser sign-in redirect (oauth auth). */
  redirectPort?: number;
}

export interface Config {
  defaultProfile: string | null;
  profiles: Record<string, Profile>;
}

export function configDir(env: Record<string, string | undefined> = process.env): string {
  if (env.EDRO_CONFIG_DIR) return env.EDRO_CONFIG_DIR;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "edro");
}

const PROFILE_NAME = /^[A-Za-z0-9_-]+$/;

export function validateProfileName(name: string): string | undefined {
  return PROFILE_NAME.test(name) ? undefined : "Use letters, digits, - and _ only.";
}

/** `https://Example.palantirfoundry.com/` → `example.palantirfoundry.com` */
export function normalizeHostname(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function loadConfig(dir: string): Config {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.toml"), "utf8");
  } catch {
    return { defaultProfile: null, profiles: {} };
  }
  let raw: Record<string, unknown>;
  try {
    raw = Bun.TOML.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new EdroError(
      `Could not parse ${join(dir, "config.toml")}: ${(e as Error).message}`,
      "config",
    );
  }
  const profiles: Record<string, Profile> = {};
  for (const [name, p] of Object.entries(
    (raw.profiles ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    profiles[name] = {
      hostname: String(p.hostname ?? ""),
      auth: p.auth === "client-credentials" || p.auth === "oauth" ? p.auth : "token",
      ...(typeof p.client_id === "string" ? { clientId: p.client_id } : {}),
      ...(Array.isArray(p.scopes) ? { scopes: p.scopes.map(String) } : {}),
      ...(typeof p.redirect_port === "number" ? { redirectPort: p.redirect_port } : {}),
    };
  }
  const def = typeof raw.default_profile === "string" ? raw.default_profile : null;
  return { defaultProfile: def, profiles };
}

const str = (s: string) => JSON.stringify(s);

export function serializeConfig(config: Config): string {
  const lines = ["# edro profiles. Secrets are stored in the OS keychain, not here.", ""];
  if (config.defaultProfile) lines.push(`default_profile = ${str(config.defaultProfile)}`, "");
  for (const [name, p] of Object.entries(config.profiles)) {
    lines.push(`[profiles.${name}]`, `hostname = ${str(p.hostname)}`, `auth = ${str(p.auth)}`);
    if (p.clientId) lines.push(`client_id = ${str(p.clientId)}`);
    if (p.scopes) lines.push(`scopes = [${p.scopes.map(str).join(", ")}]`);
    if (p.redirectPort) lines.push(`redirect_port = ${p.redirectPort}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function saveConfig(dir: string, config: Config): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "config.toml");
  // Write then rename, so a crash never leaves a half-written config.
  writeFileSync(`${path}.tmp`, serializeConfig(config), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
