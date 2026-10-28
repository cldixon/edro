import { describe, expect, test } from "bun:test";
import { createClient } from "../client.ts";
import {
  createFakeFetch,
  FAKE_HOSTNAME,
  FAKE_REDIRECT_PORT,
  fakeAuthorize,
  sampleState,
} from "../fake/index.ts";
import { browserLogin, memoryStore, refreshingTokenProvider, resolveConnection } from "./index.ts";

const CLIENT = "fake-public-client";

function setup() {
  const state = sampleState();
  const fetch = createFakeFetch(state);
  /** A "browser" that approves the sign-in and follows the redirect back to edro. */
  const approve = async (url: string) => {
    await globalThis.fetch(fakeAuthorize(state, url));
  };
  return { state, fetch, approve };
}

describe("browserLogin", () => {
  test("signs in through the browser and gets a refresh token", async () => {
    const { state, fetch, approve } = setup();
    const shown: string[] = [];
    const tokens = await browserLogin({
      hostname: FAKE_HOSTNAME,
      clientId: CLIENT,
      scopes: ["api:orchestration-read"],
      port: FAKE_REDIRECT_PORT,
      openUrl: approve,
      onUrl: (u) => shown.push(u),
      fetch,
    });
    expect(tokens.refreshToken).not.toBeNull();
    expect(state.tokens).toContain(tokens.accessToken);

    const url = new URL(shown[0] as string);
    expect(url.origin + url.pathname).toBe(
      `https://${FAKE_HOSTNAME}/multipass/api/oauth2/authorize`,
    );
    expect(url.searchParams.get("scope")).toBe("offline_access api:orchestration-read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${FAKE_REDIRECT_PORT}/callback`,
    );
  });

  test("rejects a redirect that doesn't match the login attempt", async () => {
    const { fetch } = setup();
    const err = await browserLogin({
      hostname: FAKE_HOSTNAME,
      clientId: CLIENT,
      scopes: [],
      port: FAKE_REDIRECT_PORT,
      openUrl: async () => {
        await globalThis.fetch(
          `http://127.0.0.1:${FAKE_REDIRECT_PORT}/callback?code=x&state=forged`,
        );
      },
      fetch,
    }).catch((e) => e);
    expect(err.message).toContain("didn't match this login attempt");
  });

  test("reports a denied sign-in", async () => {
    const { fetch, approve } = setup();
    const err = await browserLogin({
      hostname: FAKE_HOSTNAME,
      clientId: "unregistered-client",
      scopes: [],
      port: FAKE_REDIRECT_PORT,
      openUrl: approve,
      fetch,
    }).catch((e) => e);
    expect(err.message).toBe("Sign-in was not completed (invalid_request).");
  });

  test("times out if the browser never comes back", async () => {
    const { fetch } = setup();
    const err = await browserLogin({
      hostname: FAKE_HOSTNAME,
      clientId: CLIENT,
      scopes: [],
      port: FAKE_REDIRECT_PORT,
      openUrl: async () => {},
      fetch,
      timeoutMs: 50,
    }).catch((e) => e);
    expect(err.message).toBe("Timed out waiting for the browser sign-in.");
  });

  test("explains a busy port", async () => {
    const blocker = Bun.serve({
      hostname: "127.0.0.1",
      port: FAKE_REDIRECT_PORT,
      fetch: () => new Response(),
    });
    try {
      const err = await browserLogin({
        hostname: FAKE_HOSTNAME,
        clientId: CLIENT,
        scopes: [],
        port: FAKE_REDIRECT_PORT,
        openUrl: async () => {},
      }).catch((e) => e);
      expect(err.message).toContain(
        `Could not listen on http://127.0.0.1:${FAKE_REDIRECT_PORT}/callback`,
      );
      expect(err.hint).toContain("--port");
    } finally {
      blocker.stop(true);
    }
  });
});

describe("refreshingTokenProvider", () => {
  test("refreshes, caches, and saves rotated refresh tokens", async () => {
    const { state, fetch } = setup();
    state.refreshTokens["refresh-0"] = CLIENT;
    let now = 0;
    const rotated: string[] = [];
    const provider = refreshingTokenProvider({
      hostname: FAKE_HOSTNAME,
      clientId: CLIENT,
      refreshToken: "refresh-0",
      onRotate: async (t) => void rotated.push(t),
      fetch,
      now: () => now,
    });
    const [a, b] = await Promise.all([provider(), provider()]);
    expect(a).toBe(b as string);
    expect(rotated).toHaveLength(1);
    expect(state.refreshTokens["refresh-0"]).toBeUndefined();

    expect(await provider()).toBe(a);
    now += 3600_000;
    expect(await provider()).not.toBe(a);
    expect(rotated).toHaveLength(2);
  });

  test("an expired refresh token asks you to log in again", async () => {
    const { fetch } = setup();
    const provider = refreshingTokenProvider({
      hostname: FAKE_HOSTNAME,
      clientId: CLIENT,
      refreshToken: "gone",
      fetch,
    });
    const err = await provider().catch((e) => e);
    expect(err).toMatchObject({
      kind: "auth",
      hint: "Your sign-in has expired. Run `edro login` again.",
    });
  });
});

test("an oauth profile resolves to a working client and persists rotation", async () => {
  const { state, fetch } = setup();
  state.refreshTokens["refresh-0"] = CLIENT;
  const secrets = memoryStore({ "dev/refresh_token": "refresh-0" });
  const conn = await resolveConnection({
    flags: {},
    env: {},
    config: {
      defaultProfile: "dev",
      profiles: { dev: { hostname: FAKE_HOSTNAME, auth: "oauth", clientId: CLIENT } },
    },
    secrets,
    fetch,
  });
  const client = createClient({
    hostname: conn.hostname,
    tokenProvider: conn.tokenProvider,
    fetch,
  });
  expect((await client.whoami()).username).toBe("ada.example");
  expect(await secrets.get("dev", "refresh_token")).not.toBe("refresh-0");
});
