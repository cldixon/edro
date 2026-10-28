import { expect, test } from "bun:test";

// tab keeps global state and prints with console.log, so run the CLI as a process.
async function complete(...words: string[]): Promise<string[]> {
  const proc = Bun.spawn(["bun", `${import.meta.dir}/index.ts`, "complete", "--", ...words], {
    stdout: "pipe",
  });
  return (await new Response(proc.stdout).text()).trim().split("\n");
}

test("completes nested commands", async () => {
  expect(await complete("builds", "")).toContain(
    "watch\tWait for a build to finish; exits 5 if it doesn't succeed",
  );
});

test("completes flag values on nested commands", async () => {
  expect((await complete("builds", "ls", "--status", "")).slice(0, 4)).toEqual([
    "running\t",
    "succeeded\t",
    "failed\t",
    "canceled\t",
  ]);
});
