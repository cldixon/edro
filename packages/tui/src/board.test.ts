import { afterEach, expect, test } from "bun:test";
import { createDemoClient, EdroError, type MellonClient } from "@edro/mellon";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { BuildBoard } from "./board.ts";

let setup: TestRendererSetup | undefined;
let board: BuildBoard | undefined;

afterEach(async () => {
  board?.stop();
  await setup?.dispose();
});

async function mount(client: MellonClient, opened: string[] = []) {
  setup = await createTestRenderer({ width: 140, height: 20 });
  board = new BuildBoard(setup.renderer, {
    client,
    openUrl: async (url) => void opened.push(url),
    intervalMs: 10_000,
  });
  await board.refresh();
  board.stop();
  await setup.renderOnce();
  return { setup, board };
}

test("lists builds and moves the selection with j/k", async () => {
  const { setup, board } = await mount(createDemoClient());
  const frame = setup.captureCharFrame();
  expect(frame).toContain("edro · builds · example.palantirfoundry.com");
  expect(frame).toContain("running");
  expect(frame).toContain("feature/new-metrics");
  expect(board.selected).toBe(0);
  await board.handleKey("j");
  await board.handleKey("down");
  expect(board.selected).toBe(2);
  await board.handleKey("k");
  expect(board.selected).toBe(1);
});

test("enter shows a build's jobs, escape goes back, o opens it", async () => {
  const opened: string[] = [];
  const { setup, board } = await mount(createDemoClient(), opened);
  await board.handleKey("return");
  board.stop();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("OUTPUT");
  expect(frame).toContain("ri.foundry.main.dataset.");
  await board.handleKey("o");
  expect(opened[0]).toContain("/job-tracker/builds/ri.foundry.main.build.");
  expect(await board.handleKey("escape")).toBe(true);
  expect(board.detail).toBeNull();
  expect(await board.handleKey("q")).toBe(false);
});

test("backs off after errors and shows them", async () => {
  const failing = createDemoClient();
  failing.builds.search = async () => {
    throw new EdroError("Rate limited by Foundry.", "rate_limited");
  };
  const { setup, board } = await mount(failing);
  expect(board.nextDelay()).toBe(20_000);
  await board.refresh();
  board.stop();
  expect(board.nextDelay()).toBe(40_000);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Rate limited by Foundry.");
});
