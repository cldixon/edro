# Contributing

## Setup

```bash
bun install
```

This also installs a pre-commit hook (via [lefthook](https://github.com/evilmartians/lefthook)) that
scans staged changes for secrets with [gitleaks](https://github.com/gitleaks/gitleaks). The hook
needs `gitleaks` on your `PATH` and refuses the commit if it's missing:

```bash
brew install gitleaks
```

Other platforms: see the [gitleaks install guide](https://github.com/gitleaks/gitleaks#installing).

Before opening a PR, run `bun run lint`, `bun run typecheck` and `bun test`.

## Keep real Foundry data out

edro is public. Never commit anything from a real Foundry instance: hostnames, RIDs, project,
dataset or ontology names, user names, tokens, logs or screenshots. Use obviously fake data such as
`example.palantirfoundry.com` in tests and examples. [`CLAUDE.md`](CLAUDE.md) has the full rules.

### Block your employer's hostname locally

The shared gitleaks config catches tokens, but it can't know which hostnames matter to you, and
committing them would leak them. Add them to a personal, **uncommitted** config instead:

```bash
cp .gitleaks.local.toml.example .gitleaks.local.toml
```

Then edit the `regex` in `.gitleaks.local.toml` to match your hostname(s). The file is gitignored,
extends the shared config, and is picked up automatically by the hook. Check it works:

```bash
scripts/gitleaks.sh history
```

### Blocking hostnames in CI (maintainers)

To have CI enforce the same rules, store the full contents of your `.gitleaks.local.toml` as a
repository secret named `GITLEAKS_LOCAL_CONFIG`. The `secrets` CI job writes it to disk before
scanning. Secrets aren't available to pull requests from forks, so those are only checked against
the shared config.
