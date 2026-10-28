// Builds the publishable npm package in dist/npm:
//
//   bun scripts/build-npm.ts
//
// The workspace packages (mellon, tui and the CLI) are bundled into
// dist/npm/dist; third-party packages stay ordinary dependencies, so npm
// installs the right OpenTUI native library for each platform. The TUI is
// its own chunk, loaded only by `edro ui`. The package runs on Bun.
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist/npm");
const readJson = async (path: string) => Bun.file(join(root, path)).json();

const cli = await readJson("packages/edro/package.json");
const workspaces = [
  cli,
  await readJson("packages/mellon/package.json"),
  await readJson("packages/telchar/package.json"),
];

// Third-party dependencies of every bundled workspace, at their pinned versions.
const dependencies: Record<string, string> = {};
for (const pkg of workspaces) {
  for (const [name, version] of Object.entries<string>(pkg.dependencies ?? {})) {
    if (version.startsWith("workspace:")) continue;
    if (dependencies[name] && dependencies[name] !== version) {
      throw new Error(`${name} is pinned to both ${dependencies[name]} and ${version}`);
    }
    dependencies[name] = version;
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "packages/edro/src/index.ts")],
  outdir: join(out, "dist"),
  target: "bun",
  splitting: true,
  // Keep every third-party package (and its subpaths) out of the bundle.
  external: Object.keys(dependencies).flatMap((name) => [name, `${name}/*`]),
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const entry = join(out, "dist/index.js");
const code = await Bun.file(entry).text();
if (!code.startsWith("#!")) await Bun.write(entry, `#!/usr/bin/env bun\n${code}`);
chmodSync(entry, 0o755);

const manifest = {
  name: "edro",
  version: cli.version,
  description: "An unofficial command-line tool and terminal UI for Palantir Foundry",
  license: "MIT",
  type: "module",
  bin: { edro: "dist/index.js" },
  files: ["dist"],
  engines: { bun: ">=1.3.14" },
  dependencies,
  repository: { type: "git", url: "git+https://github.com/cldixon/edro.git" },
  homepage: "https://github.com/cldixon/edro#readme",
  bugs: "https://github.com/cldixon/edro/issues",
  keywords: ["foundry", "cli", "tui", "builds", "palantir"],
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ["README.md", "LICENSE"]) cpSync(join(root, file), join(out, file));

console.log(`Built ${manifest.name}@${manifest.version} in dist/npm:`);
for (const o of result.outputs)
  console.log(`  ${o.path.slice(out.length + 1)}  ${(o.size / 1024).toFixed(0)} KB`);
