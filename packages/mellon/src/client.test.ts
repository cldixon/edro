import { describe, expect, test } from "bun:test";
import { createClient, NotImplementedError } from "./index.ts";

describe("createClient", () => {
  test("keeps the profile it was created with", () => {
    const profile = { name: "dev", hostname: "example.palantirfoundry.com" };
    expect(createClient(profile).profile).toEqual(profile);
  });

  test("whoami is a stub for now", async () => {
    const client = createClient({ name: "dev", hostname: "example.palantirfoundry.com" });
    await expect(client.whoami()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
