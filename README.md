# edro

A command-line tool and terminal UI for Palantir Foundry, written in TypeScript.

> **Status:** early and experimental, and not yet tested against a real Foundry instance.
>
> edro is an unofficial community project. It is not affiliated with or endorsed by Palantir.

## Install

edro runs on [Bun](https://bun.sh) 1.3.14 or later.

```bash
bun add -g edro
```

`npm install -g edro` works too, but Bun must still be installed to run it. Bun puts global commands in
`~/.bun/bin`, which its installer adds to your PATH. To update later:

```bash
bun add -g edro@latest
```

## Try it without an account

`--demo` runs on made-up data with builds that start and finish in real time:

```bash
edro ui --demo
```

```bash
edro builds ls --demo
```

## Signing in

```bash
edro login
```

`edro login` asks for a hostname and how to authenticate, checks the credentials, and saves a profile:

- **Personal token**, from Developer Console.
- **Sign in with browser**: needs an OAuth app in Developer Console whose redirect URL is
  `http://127.0.0.1:8765/callback` (or pick another port with `--port`). edro keeps a refresh token, so you
  stay signed in. Without prompts: `edro login --auth oauth --hostname <host> --client-id <id>`.
- **OAuth client credentials**, for automation.

Profiles live in `~/.config/edro/config.toml` (or `$XDG_CONFIG_HOME/edro`); secrets go
to the OS keychain, never to that file.

In CI and containers, which usually have no keychain, use environment variables instead. They use the same
names as Foundry's Python SDK: `FOUNDRY_HOSTNAME` with `FOUNDRY_TOKEN`, or with `FOUNDRY_CLIENT_ID` and
`FOUNDRY_CLIENT_SECRET`. To log in from a script, pipe the token in:

```bash
edro login --hostname example.palantirfoundry.com --with-token < token.txt
```

Which credentials win: an explicit `--profile`, then `--hostname` and the `FOUNDRY_*` variables, then the
`EDRO_PROFILE` or default profile.

## Commands

| Command                     | What it does                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `edro builds ls`            | Your builds from the last 24h. Filters: `--status`, `--since`, `--branch`, `--limit`, `--all`, `--all-users` |
| `edro builds get <rid>`     | One build                                                                                                    |
| `edro builds jobs <rid>`    | A build's jobs and their output datasets                                                                     |
| `edro builds watch <rid>`   | Wait for a build to finish; exits 5 if it doesn't succeed                                                    |
| `edro schedules ls`         | Schedules that started your builds in the last 7 days                                                        |
| `edro schedules runs <rid>` | A schedule's recent runs                                                                                     |
| `edro open <rid>`           | Open a resource in the Foundry web UI (`--print` for the URL)                                                |
| `edro ui`                   | Live list of your builds in the terminal (`--all-users` for everyone's)                                      |
| `edro login` / `logout`     | Manage credentials                                                                                           |
| `edro profiles ls\|use\|rm` | Manage profiles                                                                                              |
| `edro whoami`               | Show the signed-in user                                                                                      |

Build lists show your own builds by default: searching everyone's builds can take many seconds on a busy
instance. Add `--all-users` to include them, and `--since 7d` to look further back.

`edro <command> --help` lists a command's flags. Shell completions: `edro complete zsh` (or `bash`, `fish`,
`powershell`) prints a script to `source`.

### For scripts and agents

Data commands accept `--json`. The output is edro's own model (lowercase statuses, ISO timestamps,
`durationMs`), not the raw API response, so it stays stable as the API changes. With `--json`, errors are
JSON on stderr: `{"error": {"kind": "...", "message": "...", "hint": "..."}}`.

| Exit code | Meaning                                          |
| --------- | ------------------------------------------------ |
| 0         | Success                                          |
| 1         | Error (including configuration problems)         |
| 2         | Bad command, argument or flag                    |
| 3         | Not authenticated, or permission denied          |
| 4         | Not found                                        |
| 5         | `builds watch`: the build failed or was canceled |

## Development

```
packages/
  mellon/  core library: Foundry client, auth, profiles, domain models
  edro/    the CLI (Bombshell args and tab completions)
  telchar/ the TUI (built on OpenTUI), started with `edro ui`
```

The CLI and TUI never call the Foundry SDK directly; everything Foundry-specific goes through `mellon`.
Tests run the real SDK against a fake Foundry API (`packages/mellon/src/fake`), so they need no network or
credentials; `--demo` uses the same fake.

Developing edro needs [Bun](https://bun.sh) 1.4.4 or later (older versions can't read `bun.lock`). From a
clone, `bun run edro` runs the CLI from source.

```bash
bun install
```

```bash
bun run edro --help
```

```bash
bun run edro ui --demo
```

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `bun test`          | Run the tests                               |
| `bun run typecheck` | Type-check every package                    |
| `bun run lint`      | Lint and check formatting (`format` to fix) |
| `bun run build`     | Compile a single `dist/edro` binary         |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never commit anything from a real Foundry instance.

## License

[MIT](LICENSE)
