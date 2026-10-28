// Compiles the `edro` binary for the current platform.
//
// OpenTUI loads its native library from a per-platform package
// (`@opentui/core-<os>-<arch>`), and only the current platform's is installed.
// The bundler would fail on the others, so mark them external; they're never
// reached at runtime on this platform.
import { $ } from "bun";

const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
];
const current = `${process.platform}-${process.arch}`;
const externals = platforms
  .filter((p) => p !== current)
  .flatMap((p) => ["--external", `@opentui/core-${p}`]);

await $`bun build --compile packages/edro/src/index.ts --outfile dist/edro ${externals}`;
