import { describe, expect, test } from "bun:test";
import { createClient } from "../client.ts";
import {
  createFakeFetch,
  FAKE_HOSTNAME,
  type FakeFoundryState,
  sampleState,
} from "../fake/index.ts";
import { recordFixtures, Scrubber, stateFromRecording } from "./index.ts";

// A stand-in for a personal instance: made-up, but shaped like real data
// (random IDs, a named person) so the scrubber has something to do.
const SOURCE_HOST = "my-dev-tier.invalid";
const TOKEN = "dev-tier-token-1234567890";
// Built at runtime from obviously fake parts, so no token-shaped literal lives in the repo.
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const JWT_LIKE = [b64('{"alg":"HS256"}'), b64('{"sub":"fake-user"}'), b64("fake-signature")].join(".");

function realisticState(): { state: FakeFoundryState; originals: string[] } {
  let json = JSON.stringify(sampleState(Date.parse("2026-10-27T12:00:00Z")));
  const ids = new Map<string, string>();
  json = json.replace(/00000000-0000-0000-0000-[0-9a-f]{12}/g, (m) => {
    if (!ids.has(m)) ids.set(m, crypto.randomUUID());
    return ids.get(m) as string;
  });
  const state = JSON.parse(json) as FakeFoundryState;
  state.tokens = [TOKEN];
  state.currentUser = {
    ...state.currentUser,
    username: "jane.doe",
    givenName: "Jane",
    familyName: "Doe",
    email: `jane.doe@${SOURCE_HOST}`,
    realm: "jane-realm",
    attributes: { "multipass:email:primary": [`jane.doe@${SOURCE_HOST}`] },
  };
  const schedule = state.schedules[0] as FakeFoundryState["schedules"][number];
  schedule.description = `Owned by jane.doe, see https://${SOURCE_HOST}/workspace. Token ${JWT_LIKE}`;
  return {
    state,
    originals: [SOURCE_HOST, "jane", "Doe", "jane-realm", TOKEN, JWT_LIKE, ...ids.values()],
  };
}

async function record(state: FakeFoundryState, allowedHosts = [SOURCE_HOST]) {
  return recordFixtures({
    hostname: SOURCE_HOST,
    tokenProvider: async () => TOKEN,
    allowedHosts,
    fetch: createFakeFetch(state),
    now: () => Date.parse("2026-10-27T12:00:00Z"),
  });
}

describe("recordFixtures", () => {
  test("refuses hosts that aren't on the allowlist", async () => {
    const { state } = realisticState();
    const err = await record(state, ["someone-else.invalid"]).catch((e) => e);
    expect(err.message).toContain("Refusing to record from my-dev-tier.invalid");
  });

  test("records builds, jobs and schedules with nothing original left", async () => {
    const { state, originals } = realisticState();
    const { data, counts } = await record(state);
    expect(counts).toEqual({ currentUser: 1, builds: 4, jobs: 12, schedules: 1, scheduleRuns: 3 });

    const json = JSON.stringify(data);
    for (const original of originals)
      expect(json.toLowerCase()).not.toContain(original.toLowerCase());
    expect(data.currentUser).toMatchObject({
      username: "user-1",
      givenName: "Ada",
      familyName: "Example",
      email: "user-1@example.com",
      attributes: {},
    });
    expect(data.schedules[0]?.description).toBe(
      `Owned by user-1, see https://${FAKE_HOSTNAME}/workspace. Token [redacted-token]`,
    );
  });

  test("keeps links between builds, jobs and schedules", async () => {
    const { state } = realisticState();
    const { data } = await record(state);
    const buildRids = new Set(data.builds.map((b) => b.rid));
    for (const job of data.jobs) expect(buildRids.has(job.buildRid)).toBe(true);
    for (const b of data.builds) {
      expect(b.rid).toMatch(/^ri\.foundry\.main\.build\.00000000-0000-0000-0000-/);
      if (b.scheduleRid) expect(data.schedules.map((s) => s.rid)).toContain(b.scheduleRid);
      expect(b.createdBy).toBe(data.currentUser.id);
    }
  });

  test("a recording can be served by the fake API", async () => {
    const { state } = realisticState();
    const { data } = await record(state);
    const replay = stateFromRecording(data);
    const client = createClient({
      hostname: FAKE_HOSTNAME,
      tokenProvider: async () => "fake-token",
      fetch: createFakeFetch(replay),
    });
    const builds = await client.builds.search({ since: new Date("2026-01-01") });
    expect(builds.items).toHaveLength(4);
    expect((await client.whoami()).username).toBe("user-1");
  });
});

describe("Scrubber", () => {
  test("maps the same ID to the same fake every time", () => {
    const s = new Scrubber(SOURCE_HOST);
    const id = crypto.randomUUID();
    const out = s.scrub({
      a: `ri.foundry.main.dataset.${id}`,
      b: [`ri.foundry.main.dataset.${id}`],
      c: id,
    });
    expect(out.a).toBe(out.b[0] as string);
    expect(out.a).toMatch(/^ri\.foundry\.main\.dataset\.00000000-0000-0000-0000-[0-9a-f]{12}$/);
    expect(out.c).toMatch(/^00000000-0000-0000-0000-[0-9a-f]{12}$/);
    expect(new Scrubber(SOURCE_HOST).scrub(id)).not.toBe(id);
  });

  test("scrubs object keys too", () => {
    const id = crypto.randomUUID();
    const out = new Scrubber(SOURCE_HOST).scrub({
      data: { [`ri.scheduler.main.schedule.${id}`]: 1 },
    });
    expect(Object.keys(out.data)[0]).toMatch(/^ri\.scheduler\.main\.schedule\.00000000-/);
  });

  test("reports secrets it couldn't remove", () => {
    const s = new Scrubber(SOURCE_HOST, ["plain-secret-value"]);
    const out = s.scrub({ note: "contains plain-secret-value" });
    expect(s.leaks(JSON.stringify(out))).toEqual(["plain-secret-value"]);
  });
});
