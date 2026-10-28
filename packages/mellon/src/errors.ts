export type ErrorKind = "auth" | "permission" | "not_found" | "rate_limited" | "config" | "api";

/** An error with a message meant for people, and an optional hint on what to do next. */
export class EdroError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly hint?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EdroError";
  }

  toJSON() {
    return { kind: this.kind, message: this.message, hint: this.hint ?? null, ...this.details };
  }
}

/** The fields of Foundry's error body, as the SDK surfaces them on PalantirApiError. */
interface ApiErrorLike {
  message: string;
  statusCode?: number;
  errorCode?: string;
  errorName?: string;
  errorInstanceId?: string;
  parameters?: Record<string, unknown>;
}

function isApiError(e: unknown): e is ApiErrorLike {
  // Checked by shape: several copies of the SDK's error class can be installed.
  return e instanceof Error && ("errorName" in e || "statusCode" in e);
}

/** Converts SDK and network errors into EdroErrors with readable messages. */
export function toEdroError(e: unknown): EdroError {
  if (e instanceof EdroError) return e;
  const unreachable = (message: string) =>
    new EdroError(
      `Could not reach Foundry: ${message}`,
      "api",
      "Check the hostname and your network connection.",
    );
  // The SDK wraps network failures in its API error class, without a status.
  if (isApiError(e) && e.statusCode === undefined) return unreachable(e.message);
  if (isApiError(e)) {
    const details = {
      status: e.statusCode ?? null,
      errorName: e.errorName ?? null,
      errorInstanceId: e.errorInstanceId ?? null,
      parameters: e.parameters ?? {},
    };
    const name = e.errorName ?? e.errorCode ?? "UnknownError";
    switch (e.statusCode) {
      case 401:
        return new EdroError(
          `Not authenticated (${name}).`,
          "auth",
          "Your token may have expired. Run `edro login`.",
          details,
        );
      case 403:
        return new EdroError(
          `Permission denied (${name}).`,
          "permission",
          "Check that your token or OAuth client has the required scopes (e.g. api:orchestration-read).",
          details,
        );
      case 404:
        return new EdroError(`Not found (${name}).`, "not_found", undefined, details);
      case 429:
        return new EdroError(
          "Rate limited by Foundry.",
          "rate_limited",
          "Try again shortly.",
          details,
        );
    }
    return new EdroError(`Foundry returned an error: ${name}.`, "api", undefined, details);
  }
  if (e instanceof TypeError && /fetch|connect|network|resolve|dns/i.test(e.message)) {
    return unreachable(e.message);
  }
  return new EdroError(e instanceof Error ? e.message : String(e), "api");
}
