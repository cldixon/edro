import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { findCommand, main } from "./cli.ts";
import type { Io } from "./io.ts";

function capture(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

describe("edro", () => {
  test("--version prints the package version", async () => {
    const io = capture();
    expect(await main(["--version"], io)).toBe(0);
    expect(io.stdout).toEqual([pkg.version]);
  });

  test("--help lists commands", async () => {
    const io = capture();
    expect(await main(["--help"], io)).toBe(0);
    expect(io.stdout.join("\n")).toContain("whoami");
  });

  test("unknown commands fail", async () => {
    const io = capture();
    expect(await main(["nope"], io)).toBe(1);
    expect(io.stderr[0]).toContain("unknown command");
  });

  test("whoami --json prints JSON", async () => {
    const io = capture();
    expect(await main(["whoami", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout.join(""))).toHaveProperty("user", null);
  });

  test("findCommand prefers the longest matching path", () => {
    const run = () => 0;
    const defs = [
      { path: ["builds"], description: "", run },
      { path: ["builds", "ls"], description: "", run },
    ];
    const match = findCommand(["builds", "ls", "extra"], defs);
    expect(match?.command.path).toEqual(["builds", "ls"]);
    expect(match?.rest).toEqual(["extra"]);
  });
});
