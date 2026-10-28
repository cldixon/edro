import { expect, test } from "bun:test";
import { createDemoClient } from "./demo.ts";

test("demo builds start, progress and finish over time", async () => {
  let now = Date.parse("2026-10-27T12:00:00Z");
  const client = createDemoClient(() => now);

  const [running] = (await client.builds.search()).items;
  expect(running?.status).toBe("running");
  const rid = running?.rid as string;
  expect((await client.builds.jobs(rid)).items.map((j) => j.status)).toEqual([
    "running",
    "waiting",
    "waiting",
  ]);

  now += 30_000;
  expect((await client.builds.get(rid)).status).not.toBe("running");

  now += 45_000;
  const [newest] = (await client.builds.search()).items;
  expect(newest?.rid).not.toBe(rid);
  expect(newest?.status).toBe("running");
});
