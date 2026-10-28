import type { EdroError } from "@edro/mellon";

/** Exit codes. Part of edro's contract with scripts and agents, like `--json`. */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  /** `edro builds watch`: the build finished but didn't succeed. */
  buildFailed: 5,
} as const;

export function exitCodeFor(error: EdroError): number {
  switch (error.kind) {
    case "auth":
    case "permission":
      return EXIT.auth;
    case "not_found":
      return EXIT.notFound;
    default:
      return EXIT.error;
  }
}

/** Bad arguments or flags. */
export class UsageError extends Error {
  override name = "UsageError";
}
