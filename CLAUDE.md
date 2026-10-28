# edro

An unofficial, open-source CLI and TUI for Palantir Foundry. This repo is public.

## Hard rules: keep real Foundry data out

These apply to every file, commit, test, fixture, comment, PR and issue.

- Never add anything from a real Foundry instance other than the maintainer's personal Developer Tier: no hostnames, RIDs, project, dataset or ontology names, user names or IDs, tokens, logs or screenshots.
- Test fixtures and examples use obviously fake data: `example.palantirfoundry.com`, made-up RIDs like `ri.foundry.main.dataset.00000000-0000-0000-0000-000000000000`, invented names.
- Recorded fixtures come only from the personal Developer Tier and are scrubbed of the hostname and user IDs before saving.
- Config and credentials live outside the repo: `~/.config/edro/` and the OS keychain. Never write tokens to files in the repo, and never print them, including in verbose or debug output.
- edro only ever sends requests to the Foundry host the user configured. Don't add telemetry or calls to any other service.
- Never bypass the gitleaks pre-commit hook (`--no-verify`, `LEFTHOOK=0`). If it flags something, remove the data instead.
- Don't use Palantir or Foundry as the product name or logo.

## Architecture

- `packages/mellon`: core library. The only package that may import `@osdk/*`.
  - `client.ts` wraps the SDK and returns domain models (`models.ts`), which are also the `--json` output.
  - `auth/` handles profiles (`config.toml`), keychain secrets and credential resolution.
  - `fake/` is a fake Foundry API (a fake `fetch`) with made-up data; tests and `--demo` use it.
  - `record/` records and scrubs fixtures from the personal Developer Tier (`bun run record-fixtures`).
- `packages/edro`: the CLI. Commands live in `src/commands/`; data commands support `--json`.
  Exit codes are in `src/exit.ts` and are part of the contract with scripts, like `--json`.
- `packages/telchar`: the TUI (built on OpenTUI), started by `edro ui`.

Tests never touch the network: run commands against the fake API (see `packages/edro/src/testing.ts`).

## Commands

- `bun install`
- `bun test`
- `bun run typecheck`
- `bun run lint` (`bun run format` to fix)
- `bun run build`, which writes `dist/edro`
