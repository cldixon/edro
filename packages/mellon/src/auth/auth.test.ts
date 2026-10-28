import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../client.ts";
import { createFakeFetch, FAKE_HOSTNAME, FAKE_TOKEN, sampleState } from "../fake/index.ts";
import {
  type Config,
  configDir,
  loadConfig,
  memoryStore,
  normalizeHostname,
  resolveConnection,
  saveConfig,
} from "./index.ts";

const config: Config = {
  defaultProfile: "dev",
  profiles: {
    dev: { hostname: FAKE_HOSTNAME, auth: "token" },
    ci: {
      hostname: "ci.example.palantirfoundry.com",
      auth: "client-credentials",
      clientId: "fake-client-id",
      scopes: ["api:orchestration-read"],
    },
  },
};

describe("config", () => {
  test("round-trips through config.toml", () => {
    const dir = mkdtempSync(join(tmpdir(), "edro-config-"));
    saveConfig(dir, config);
    expect(loadConfig(dir)).toEqual(config);
  });

  test("a missing file is an empty config", () => {
    expect(loadConfig(join(tmpdir(), "edro-does-not-exist"))).toEqual({
      defaultProfile: null,
      profiles: {},
    });
  });

  test("respects XDG_CONFIG_HOME", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x" })).toBe("/x/edro");
    expect(configDir({ EDRO_CONFIG_DIR: "/y" })).toBe("/y");
  });

  test("normalizes hostnames", () => {
    expect(normalizeHostname(" https://Example.palantirfoundry.com/workspace ")).toBe(
      "example.palantirfoundry.com",
    );
  });
});

describe("resolveConnection", () => {
  const secrets = memoryStore({
    "dev/token": "dev-token",
    "ci/client_secret": "fake-client-secret",
  });

  test("uses the default profile and its keychain token", async () => {
    const conn = await resolveConnection({ flags: {}, env: {}, config, secrets });
    expect(conn).toMatchObject({ hostname: FAKE_HOSTNAME, profile: "dev", source: "profile" });
    expect(await conn.tokenProvider()).toBe("dev-token");
  });

  test("environment variables beat the default profile", async () => {
    const env = {
      FOUNDRY_HOSTNAME: "https://env.example.palantirfoundry.com",
      FOUNDRY_TOKEN: "env-token",
    };
    const conn = await resolveConnection({ flags: {}, env, config, secrets });
    expect(conn).toMatchObject({
      hostname: "env.example.palantirfoundry.com",
      source: "env",
      profile: null,
    });
    expect(await conn.tokenProvider()).toBe("env-token");
  });

  test("an explicit --profile beats environment variables", async () => {
    const env = { FOUNDRY_TOKEN: "env-token" };
    const conn = await resolveConnection({ flags: { profile: "dev" }, env, config, secrets });
    expect(await conn.tokenProvider()).toBe("dev-token");
  });

  test("--hostname overrides the profile's host", async () => {
    const conn = await resolveConnection({
      flags: { hostname: "other.example.com" },
      env: {},
      config,
      secrets,
    });
    expect(conn.hostname).toBe("other.example.com");
  });

  test("errors clearly when nothing is configured", async () => {
    const empty = { defaultProfile: null, profiles: {} };
    const err = await resolveConnection({ flags: {}, env: {}, config: empty, secrets }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ kind: "config", message: "No Foundry host configured." });
  });

  test("errors on an unknown profile", async () => {
    const err = await resolveConnection({
      flags: { profile: "nope" },
      env: {},
      config,
      secrets,
    }).catch((e) => e);
    expect(err.message).toContain('No profile named "nope"');
  });

  test("errors when the keychain has no token", async () => {
    const err = await resolveConnection({
      flags: {},
      env: {},
      config,
      secrets: memoryStore(),
    }).catch((e) => e);
    expect(err).toMatchObject({ kind: "auth" });
    expect(err.hint).toContain("edro login --profile dev");
  });

  test("client credentials fetch a token from the OAuth endpoint", async () => {
    const state = sampleState();
    const fakeFetch = createFakeFetch(state);
    const conn = await resolveConnection({
      flags: { profile: "ci" },
      env: {},
      config: {
        ...config,
        profiles: {
          ci: { ...(config.profiles.ci as Config["profiles"][string]), hostname: FAKE_HOSTNAME },
        },
      },
      secrets,
      fetch: fakeFetch,
    });
    const client = createClient({
      hostname: conn.hostname,
      tokenProvider: conn.tokenProvider,
      fetch: fakeFetch,
    });
    expect((await client.whoami()).username).toBe("ada.example");
    expect(state.tokens.length).toBeGreaterThan(1);
    expect(state.tokens).toContain(FAKE_TOKEN);
  });
});
