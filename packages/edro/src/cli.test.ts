import { describe, expect, test } from "bun:test";
import type { Build } from "@edro/mellon";
import { FAKE_HOSTNAME, FAKE_TOKEN, NIGHTLY_SCHEDULE } from "@edro/mellon/fake";
import pkg from "../package.json" with { type: "json" };
import { findCommand, main } from "./cli.ts";
import { EXIT } from "./exit.ts";
import { testDeps } from "./testing.ts";

const env = { FOUNDRY_HOSTNAME: FAKE_HOSTNAME, FOUNDRY_TOKEN: FAKE_TOKEN };
const json = (lines: string[]) => JSON.parse(lines.join("\n"));

describe("basics", () => {
  test("--version prints the package version", async () => {
    const deps = testDeps();
    expect(await main(["--version"], deps)).toBe(EXIT.ok);
    expect(deps.stdout).toEqual([pkg.version]);
  });

  test("--help lists commands", async () => {
    const deps = testDeps();
    expect(await main(["--help"], deps)).toBe(EXIT.ok);
    expect(deps.stdout.join("\n")).toContain("builds ls");
  });

  test("a command's --help shows its flags", async () => {
    const deps = testDeps();
    expect(await main(["builds", "ls", "--help"], deps)).toBe(EXIT.ok);
    expect(deps.stdout.join("\n")).toContain("--status <value>");
  });

  test("a bare group lists its commands", async () => {
    const deps = testDeps();
    expect(await main(["builds"], deps)).toBe(EXIT.usage);
    expect(deps.stdout.join("\n")).toContain("builds watch <buildRid>");
  });

  test("unknown commands are usage errors", async () => {
    const deps = testDeps();
    expect(await main(["nope"], deps)).toBe(EXIT.usage);
    expect(deps.stderr[0]).toContain("unknown command");
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

describe("builds", () => {
  test("ls --json returns domain models, newest first", async () => {
    const deps = testDeps({ env });
    expect(await main(["builds", "ls", "--json"], deps)).toBe(EXIT.ok);
    const builds = json(deps.stdout) as Build[];
    expect(builds.map((b) => b.status)).toEqual(["running", "succeeded", "failed", "succeeded"]);
    expect(Object.keys(builds[0] as Build).sort()).toEqual(
      [
        "branch",
        "createdAt",
        "createdBy",
        "durationMs",
        "finishedAt",
        "jobRids",
        "rid",
        "scheduleRid",
        "status",
      ].sort(),
    );
  });

  test("ls filters and limits", async () => {
    const deps = testDeps({ env });
    await main(["builds", "ls", "--status", "failed,running", "--limit", "1", "--json"], deps);
    expect(json(deps.stdout).map((b: Build) => b.status)).toEqual(["running"]);
  });

  test("ls --since excludes older builds", async () => {
    const deps = testDeps({ env });
    await main(["builds", "ls", "--since", "1h", "--json"], deps);
    expect(json(deps.stdout)).toHaveLength(2);
  });

  test("ls prints a table", async () => {
    const deps = testDeps({ env });
    await main(["builds", "ls"], deps);
    expect(deps.stdout[0]).toMatch(/^STATUS\s+BRANCH\s+STARTED\s+DURATION/);
    expect(deps.stdout[1]).toContain("running");
    expect(deps.stdout[1]).toContain("3m ago");
  });

  test("invalid flags are usage errors", async () => {
    for (const argv of [
      ["--status", "bogus"],
      ["--since", "yesterday-ish"],
      ["--limit", "0"],
    ]) {
      const deps = testDeps({ env });
      expect(await main(["builds", "ls", ...argv], deps)).toBe(EXIT.usage);
    }
  });

  test("get and jobs", async () => {
    const deps = testDeps({ env });
    const rid = deps.state.builds[0]?.rid as string;
    expect(await main(["builds", "get", rid, "--json"], deps)).toBe(EXIT.ok);
    expect(json(deps.stdout).rid).toBe(rid);
    deps.stdout.length = 0;
    expect(await main(["builds", "jobs", rid, "--json"], deps)).toBe(EXIT.ok);
    expect(json(deps.stdout)).toHaveLength(3);
  });

  test("a missing build exits 4 with a readable error", async () => {
    const deps = testDeps({ env });
    expect(await main(["builds", "get", "ri.foundry.main.build.nope"], deps)).toBe(EXIT.notFound);
    expect(deps.stderr[0]).toBe("error: Not found (BuildNotFound).");
  });

  test("errors are JSON on stderr with --json", async () => {
    const deps = testDeps({ env });
    await main(["builds", "get", "ri.foundry.main.build.nope", "--json"], deps);
    expect(json(deps.stderr).error).toMatchObject({ kind: "not_found", status: 404 });
  });

  test("watch polls until the build finishes and exits 0 on success", async () => {
    let calls = 0;
    const deps = testDeps(
      { env },
      {
        beforeRequest: (s) => {
          calls += 1;
          const running = s.builds.find((b) => b.rid === s.builds[3]?.rid);
          if (running && calls >= 3) {
            running.status = "SUCCEEDED";
            running.finishedTime = new Date().toISOString();
          }
        },
      },
    );
    const rid = deps.state.builds[3]?.rid as string;
    expect(await main(["builds", "watch", rid, "--interval", "2"], deps)).toBe(EXIT.ok);
    expect(deps.stdout.at(-1)).toContain("Build succeeded");
  });

  test("watch exits 5 when the build fails", async () => {
    const deps = testDeps({ env });
    const failed = deps.state.builds.find((b) => b.status === "FAILED")?.rid as string;
    expect(await main(["builds", "watch", failed], deps)).toBe(EXIT.buildFailed);
  });
});

describe("schedules and open", () => {
  test("schedules ls finds schedules through recent builds", async () => {
    const deps = testDeps({ env });
    expect(await main(["schedules", "ls", "--json"], deps)).toBe(EXIT.ok);
    const [schedule] = json(deps.stdout);
    expect(schedule).toMatchObject({ rid: NIGHTLY_SCHEDULE, name: "Nightly revenue pipeline" });
    expect(schedule.lastBuild.status).toBe("running");
  });

  test("schedules runs", async () => {
    const deps = testDeps({ env });
    expect(await main(["schedules", "runs", NIGHTLY_SCHEDULE, "--json"], deps)).toBe(EXIT.ok);
    expect(json(deps.stdout)).toHaveLength(3);
  });

  test("open --print prints the web URL; open opens it", async () => {
    const deps = testDeps({ env });
    const rid = deps.state.builds[0]?.rid as string;
    await main(["open", rid, "--print"], deps);
    expect(deps.stdout[0]).toBe(
      `https://${FAKE_HOSTNAME}/workspace/data-integration/job-tracker/builds/${rid}`,
    );
    await main(["open", rid], deps);
    expect(deps.opened).toEqual([deps.stdout[0] as string]);
  });

  test("--demo needs no credentials", async () => {
    const deps = testDeps();
    expect(await main(["builds", "ls", "--demo", "--json"], deps)).toBe(EXIT.ok);
    expect(json(deps.stdout).length).toBeGreaterThan(0);
  });
});

describe("auth and profiles", () => {
  test("with nothing configured, commands explain how to log in", async () => {
    const deps = testDeps();
    expect(await main(["whoami"], deps)).toBe(EXIT.error);
    expect(deps.stderr).toEqual([
      "error: No Foundry host configured.",
      "hint: Run `edro login`, or set FOUNDRY_HOSTNAME and FOUNDRY_TOKEN.",
    ]);
  });

  test("login --with-token saves a profile, and whoami uses it", async () => {
    const deps = testDeps({ readStdin: async () => `${FAKE_TOKEN}\n` });
    expect(
      await main(["login", "--hostname", `https://${FAKE_HOSTNAME}/`, "--with-token"], deps),
    ).toBe(EXIT.ok);
    expect(deps.stdout[0]).toBe(
      `Logged in to ${FAKE_HOSTNAME} as ada.example (profile "default", default).`,
    );
    expect(await deps.secrets.get("default", "token")).toBe(FAKE_TOKEN);
    expect(await Bun.file(`${deps.configDir}/config.toml`).text()).not.toContain(FAKE_TOKEN);

    deps.stdout.length = 0;
    expect(await main(["whoami", "--json"], deps)).toBe(EXIT.ok);
    expect(json(deps.stdout)).toMatchObject({
      hostname: FAKE_HOSTNAME,
      profile: "default",
      auth: "token (keychain)",
      user: { username: "ada.example" },
    });
  });

  test("login rejects a bad token and saves nothing", async () => {
    const deps = testDeps({ readStdin: async () => "wrong" });
    expect(await main(["login", "--hostname", FAKE_HOSTNAME, "--with-token"], deps)).toBe(
      EXIT.auth,
    );
    expect(await deps.secrets.get("default", "token")).toBeNull();
  });

  test("login without a terminal or --with-token is a usage error", async () => {
    const deps = testDeps();
    expect(await main(["login"], deps)).toBe(EXIT.usage);
  });

  test("profiles ls, use, rm and logout", async () => {
    const deps = testDeps({ readStdin: async () => FAKE_TOKEN });
    await main(["login", "--hostname", FAKE_HOSTNAME, "--with-token"], deps);
    await main(["login", "--profile", "second", "--hostname", FAKE_HOSTNAME, "--with-token"], deps);

    deps.stdout.length = 0;
    await main(["profiles", "ls", "--json"], deps);
    expect(
      json(deps.stdout).map((p: { name: string; default: boolean }) => [p.name, p.default]),
    ).toEqual([
      ["default", true],
      ["second", false],
    ]);

    await main(["profiles", "use", "second"], deps);
    await main(["profiles", "rm", "default"], deps);
    expect(await deps.secrets.get("default", "token")).toBeNull();

    await main(["logout"], deps);
    deps.stderr.length = 0;
    expect(await main(["whoami"], deps)).toBe(EXIT.auth);
    expect(deps.stderr[1]).toContain("edro login --profile second");
  });
});
