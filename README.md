# edro

A command-line tool and terminal UI for Palantir Foundry, written in TypeScript.

> **Status:** early and experimental. Nothing talks to Foundry yet.
>
> edro is an unofficial community project. It is not affiliated with or endorsed by Palantir.

## Layout

```
packages/
  mellon/  core library: Foundry client, auth, profiles, domain models
  edro/    the CLI (Bombshell args and tab completions)
  tui/     the OpenTUI app, started with `edro ui`
```

The CLI and TUI never call the Foundry SDK directly; everything Foundry-specific goes through `mellon`.

## Development

Requires [Bun](https://bun.sh) 1.3.14 or later.

```bash
bun install
```

```bash
bun run edro --help
```

```bash
bun run edro ui
```

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `bun test`          | Run the tests                               |
| `bun run typecheck` | Type-check every package                    |
| `bun run lint`      | Lint and check formatting (`format` to fix) |
| `bun run build`     | Compile a single `dist/edro` binary         |

Shell completions: `edro complete zsh` (or `bash`, `fish`, `powershell`) prints a script to `source`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never commit anything from a real Foundry instance.

## License

[MIT](LICENSE)
