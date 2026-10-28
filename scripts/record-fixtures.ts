// Records scrubbed fixtures from your personal Developer Tier:
//
//   EDRO_FIXTURE_HOSTS=<your-dev-tier-host> bun scripts/record-fixtures.ts [--profile <name>] [--out <file>]
//
// Uses the same credentials as edro (a profile, or FOUNDRY_HOSTNAME and
// FOUNDRY_TOKEN). Refuses any host not listed in EDRO_FIXTURE_HOSTS, which
// lives in your environment, not in the repo. Responses are scrubbed of the
// hostname, IDs and personal data, and nothing is written if anything
// original survives. Review the output before committing it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { configDir, keychainStore, loadConfig, resolveConnection, toEdroError } from "@edro/mellon";
import { recordFixtures } from "@edro/mellon/record";

const { values: args } = parseArgs({
  options: { profile: { type: "string" }, out: { type: "string" } },
});
const out = args.out ?? "packages/mellon/fixtures/recorded.json";

try {
  const conn = await resolveConnection({
    flags: { profile: args.profile },
    env: process.env,
    config: loadConfig(configDir()),
    secrets: keychainStore(),
  });
  const { data, counts } = await recordFixtures({
    hostname: conn.hostname,
    tokenProvider: conn.tokenProvider,
    allowedHosts: (process.env.EDRO_FIXTURE_HOSTS ?? "").split(",").filter(Boolean),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${out}:`, counts);
  console.log("Review it before committing; gitleaks also scans it on commit.");
} catch (e) {
  const err = toEdroError(e);
  console.error(`error: ${err.message}`);
  if (err.hint) console.error(`hint: ${err.hint}`);
  process.exit(1);
}
