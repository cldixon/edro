import { describe, expect, test } from "bun:test";
import { EdroError, toEdroError } from "./errors.ts";

class FakeApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorName?: string,
  ) {
    super(message);
  }
}

describe("toEdroError", () => {
  test("maps statuses to kinds with hints", () => {
    expect(toEdroError(new FakeApiError("", 401, "MissingCredentials"))).toMatchObject({
      kind: "auth",
    });
    expect(toEdroError(new FakeApiError("", 403, "PermissionDenied")).hint).toContain("scopes");
    expect(toEdroError(new FakeApiError("", 404, "BuildNotFound")).kind).toBe("not_found");
    expect(toEdroError(new FakeApiError("", 429)).kind).toBe("rate_limited");
    expect(toEdroError(new FakeApiError("", 500, "Internal")).message).toBe(
      "Foundry returned an error: Internal.",
    );
  });

  test("an API error without a status is a network failure", () => {
    const err = toEdroError(new FakeApiError("getaddrinfo ENOTFOUND", undefined, undefined));
    expect(err.message).toBe("Could not reach Foundry: getaddrinfo ENOTFOUND");
  });

  test("passes EdroErrors through", () => {
    const e = new EdroError("x", "config");
    expect(toEdroError(e)).toBe(e);
  });
});
