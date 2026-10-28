import { EdroError } from "../errors.ts";

// OAuth2 authorization-code login with PKCE and a localhost callback, for
// `edro login` without pasting tokens. Uses Foundry's endpoints under
// /multipass/api/oauth2, as the official SDK's browser client does.

export const DEFAULT_REDIRECT_PORT = 8765;

export const redirectUri = (port: number) => `http://127.0.0.1:${port}/callback`;

export interface OAuthTokens {
  accessToken: string;
  /** Only issued when the app allows refresh tokens (the `offline_access` scope). */
  refreshToken: string | null;
  expiresAt: number;
}

export interface BrowserLoginOptions {
  hostname: string;
  clientId: string;
  scopes: string[];
  port?: number;
  /** Opens the authorization page; the user signs in there. */
  openUrl: (url: string) => Promise<void>;
  /** Called with the authorization URL, so it can be shown in case the browser doesn't open. */
  onUrl?: (url: string) => void;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => number;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomString = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

const tokenEndpoint = (hostname: string) => `https://${hostname}/multipass/api/oauth2/token`;

async function requestTokens(
  hostname: string,
  params: Record<string, string>,
  fetchFn: typeof globalThis.fetch,
  now: number,
): Promise<OAuthTokens> {
  const res = await fetchFn(tokenEndpoint(hostname), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    const reason = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new EdroError(
      `Foundry rejected the sign-in (${reason}).`,
      "auth",
      reason === "invalid_grant" ? "Your sign-in has expired. Run `edro login` again." : undefined,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: now + Number(body.expires_in ?? 3600) * 1000,
  };
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>edro</title>
<body style="font-family:system-ui;padding:3rem">Signed in. You can close this tab and return to the terminal.</body>`;

/**
 * Runs the browser sign-in: starts a one-shot server on 127.0.0.1, opens the
 * authorization page, waits for the redirect, and exchanges the code.
 */
export async function browserLogin(options: BrowserLoginOptions): Promise<OAuthTokens> {
  const port = options.port ?? DEFAULT_REDIRECT_PORT;
  const redirect = redirectUri(port);
  const verifier = randomString();
  const state = randomString();

  let resolveCode!: (code: string) => void;
  let rejectCode!: (e: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  // The callback can fail before anything awaits this (e.g. while the browser
  // request is in flight); it's awaited below, so don't treat that as unhandled.
  codePromise.catch(() => {});

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") return new Response("Not found", { status: 404 });
        const error = url.searchParams.get("error");
        if (error) {
          rejectCode(new EdroError(`Sign-in was not completed (${error}).`, "auth"));
          return new Response("Sign-in was not completed. You can close this tab.", {
            status: 400,
          });
        }
        if (url.searchParams.get("state") !== state) {
          rejectCode(
            new EdroError("Sign-in failed: the response didn't match this login attempt.", "auth"),
          );
          return new Response("This sign-in link doesn't match. Run `edro login` again.", {
            status: 400,
          });
        }
        resolveCode(url.searchParams.get("code") ?? "");
        return new Response(DONE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    });
  } catch (e) {
    throw new EdroError(
      `Could not listen on ${redirect}: ${(e as Error).message}`,
      "config",
      "Free that port, or use another with --port (the app's redirect URL must match).",
    );
  }

  const timer = setTimeout(
    () => rejectCode(new EdroError("Timed out waiting for the browser sign-in.", "auth")),
    options.timeoutMs ?? 5 * 60_000,
  );
  try {
    const authorize = new URL(`https://${options.hostname}/multipass/api/oauth2/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: redirect,
      scope: ["offline_access", ...options.scopes].join(" "),
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    options.onUrl?.(authorize.toString());
    await options.openUrl(authorize.toString()).catch(() => {
      // Not fatal: the URL was shown, and the user can open it by hand.
    });

    const code = await codePromise;
    return await requestTokens(
      options.hostname,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: options.clientId,
        code_verifier: verifier,
      },
      options.fetch ?? globalThis.fetch,
      (options.now ?? Date.now)(),
    );
  } finally {
    clearTimeout(timer);
    // Let the browser's response finish sending, then make sure nothing lingers.
    await Promise.race([server.stop(), Bun.sleep(1000)]);
    await server.stop(true);
  }
}

export interface RefreshingTokenOptions {
  hostname: string;
  clientId: string;
  refreshToken: string;
  /** Called when Foundry rotates the refresh token, to persist the new one. */
  onRotate?: (refreshToken: string) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/** A token provider that uses a refresh token, caching each access token until shortly before it expires. */
export function refreshingTokenProvider(options: RefreshingTokenOptions): () => Promise<string> {
  const now = options.now ?? Date.now;
  let refreshToken = options.refreshToken;
  let current: OAuthTokens | null = null;
  let inFlight: Promise<string> | null = null;

  return () => {
    if (current && current.expiresAt - 60_000 > now()) return Promise.resolve(current.accessToken);
    inFlight ??= (async () => {
      try {
        current = await requestTokens(
          options.hostname,
          { grant_type: "refresh_token", refresh_token: refreshToken, client_id: options.clientId },
          options.fetch ?? globalThis.fetch,
          now(),
        );
        if (current.refreshToken && current.refreshToken !== refreshToken) {
          refreshToken = current.refreshToken;
          await options.onRotate?.(refreshToken);
        }
        return current.accessToken;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
