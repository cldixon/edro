import { describe, expect, test } from "bun:test";
import {
  createFakeFetch,
  FAKE_HOSTNAME,
  FAKE_TOKEN,
  NIGHTLY_SCHEDULE,
  sampleState,
} from "./fake/index.ts";
import { buildSearchFilter, collectPages, createClient, EdroError, webUrl } from "./index.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");

function setup(token = FAKE_TOKEN) {
  const state = sampleState(NOW);
  const log: Request[] = [];
  const client = createClient({
    hostname: FAKE_HOSTNAME,
    tokenProvider: async () => token,
    fetch: createFakeFetch(state, { log }),
  });
  return { client, state, log };
}

describe("createClient against the fake API", () => {
  test("whoami returns the current user", async () => {
    const { client } = setup();
    expect(await client.whoami()).toEqual({
      id: "00000000-0000-0000-0000-00000000a11c",
      username: "ada.example",
      name: "Ada Example",
      email: "ada@example.com",
    });
  });

  test("builds.search sends a preview request and returns newest first", async () => {
    const { client, log } = setup();
    const page = await client.builds.search({ since: new Date(NOW - 7 * 86_400_000) });
    expect(page.items.map((b) => b.status)).toEqual([
      "running",
      "succeeded",
      "failed",
      "succeeded",
    ]);
    const req = log.at(-1);
    expect(req?.url).toBe(
      `https://${FAKE_HOSTNAME}/api/v2/orchestration/builds/search?preview=true`,
    );
    expect(req?.headers.get("Authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  test("builds.search filters by status and branch", async () => {
    const { client } = setup();
    const since = new Date(NOW - 7 * 86_400_000);
    const failed = await client.builds.search({ since, status: ["failed"] });
    expect(failed.items).toHaveLength(1);
    const feature = await client.builds.search({ since, branch: "feature/new-metrics" });
    expect(feature.items.map((b) => b.branch)).toEqual(["feature/new-metrics"]);
  });

  test("builds.search pages with nextPageToken", async () => {
    const { client } = setup();
    const since = new Date(NOW - 7 * 86_400_000);
    const first = await client.builds.search({ since, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextPageToken).not.toBeNull();
    const all = await collectPages((pageToken) =>
      client.builds.search({ since, pageSize: 3, pageToken }),
    );
    expect(all).toHaveLength(4);
  });

  test("builds.get and builds.jobs return domain models", async () => {
    const { client, state } = setup();
    const rid = state.builds.find((b) => b.status === "FAILED")?.rid as string;
    const build = await client.builds.get(rid);
    expect(build).toMatchObject({ rid, status: "failed", branch: "master", durationMs: 120_000 });
    const jobs = await client.builds.jobs(rid);
    expect(jobs.items.map((j) => j.status)).toEqual(["succeeded", "succeeded", "failed"]);
    expect(jobs.items[0]?.outputs[0]?.type).toBe("dataset");
  });

  test("schedules.get and schedules.runs", async () => {
    const { client } = setup();
    expect((await client.schedules.get(NIGHTLY_SCHEDULE)).name).toBe("Nightly revenue pipeline");
    const runs = await client.schedules.runs(NIGHTLY_SCHEDULE);
    expect(runs.items).toHaveLength(3);
    expect(runs.items[0]?.result.type).toBe("submitted");
  });

  test("a 404 becomes a not_found EdroError", async () => {
    const { client } = setup();
    const err = await client.builds.get("ri.foundry.main.build.missing").catch((e) => e);
    expect(err).toBeInstanceOf(EdroError);
    expect(err.kind).toBe("not_found");
    expect(err.toJSON()).toMatchObject({ status: 404, errorName: "BuildNotFound" });
  });

  test("a bad token becomes an auth EdroError with a hint", async () => {
    const { client } = setup("wrong-token");
    const err = await client.whoami().catch((e) => e);
    expect(err.kind).toBe("auth");
    expect(err.hint).toContain("edro login");
  });
});

describe("buildSearchFilter", () => {
  test("defaults to the last 7 days", () => {
    expect(buildSearchFilter({}, NOW)).toEqual({
      type: "gte",
      field: "STARTED_TIME",
      value: new Date(NOW - 7 * 86_400_000).toISOString(),
    });
  });

  test("ors multiple statuses together", () => {
    const filter = buildSearchFilter({ status: ["running", "failed"] }, NOW);
    expect(filter).toMatchObject({ type: "and", items: [{ type: "gte" }, { type: "or" }] });
  });
});

test("webUrl links builds, datasets and other resources", () => {
  expect(webUrl("h", "ri.foundry.main.build.1")).toContain("/job-tracker/builds/");
  expect(webUrl("h", "ri.foundry.main.dataset.1")).toContain("/dataset/preview/");
  expect(webUrl("h", "ri.scheduler.main.schedule.1")).toContain("/compass/view/");
});
