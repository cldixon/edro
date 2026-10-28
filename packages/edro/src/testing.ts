import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@edro/mellon";
import {
  createFakeFetch,
  type FakeFetchOptions,
  type FakeFoundryState,
  sampleState,
} from "@edro/mellon/fake";
import type { Deps } from "./context.ts";

export const NOW = Date.parse("2026-10-27T12:00:00Z");

export type TestDeps = Deps & {
  stdout: string[];
  stderr: string[];
  opened: string[];
  state: FakeFoundryState;
};

/** Deps for running commands against the fake API, with captured output. */
export function testDeps(
  overrides: Partial<Deps> = {},
  fetchOptions: FakeFetchOptions = {},
): TestDeps {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const opened: string[] = [];
  const state = sampleState(NOW);
  let now = NOW;
  return {
    stdout,
    stderr,
    opened,
    state,
    io: { out: (l) => void stdout.push(l), err: (l) => void stderr.push(l), color: false },
    env: {},
    configDir: mkdtempSync(join(tmpdir(), "edro-test-")),
    secrets: memoryStore(),
    fetch: createFakeFetch(state, fetchOptions),
    interactive: false,
    readStdin: async () => "",
    openUrl: async (url) => void opened.push(url),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    ...overrides,
  };
}
