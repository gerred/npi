<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://code.noumena.com/logos/wordmark-light.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://code.noumena.com/logos/wordmark-dark.svg">
    <img src="https://code.noumena.com/logos/wordmark-dark.svg" alt="Noumena" width="260">
  </picture>
</p>

# @gerred/npi-coding-agent

Noumena-specific terminal coding-agent CLI. This package installs the `npi`
binary and uses `~/.npi/agent` for user configuration.

Built-in provider support is intentionally narrow:

- Provider: `noumena`
- Model: `kimi-2.7-coder`
- Default endpoint: `https://api.noumena.com/v1`

## Status

This is an unofficial community package. It is not an official Noumena harness
and is not maintained by Noumena. For the official Noumena Code project, see
[Noumena-Network/code](https://github.com/Noumena-Network/code).

## Install

```bash
npm install -g --ignore-scripts @gerred/npi-coding-agent
npi
```

Use `/login` for Noumena OAuth, or set an API key:

```bash
export NOUMENA_API_KEY=...
npi
```

ncode-compatible key file:

```bash
export NOUMENA_API_KEY_FILE=~/.config/noumena/ncode/api_key
npi
```

## Common Commands

| Command | Description |
|---------|-------------|
| `/login` | Authenticate with Noumena |
| `/logout` | Clear saved OAuth credentials |
| `/model` | Show the model selector |
| `/settings` | Change thinking level, theme, message delivery, and transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/compact` | Compact long context |
| `/export` | Export a session to HTML |
| `/trust` | Trust the current project resources |
| `/hotkeys` | Show keyboard shortcuts |
| `/quit` | Quit npi |

## CLI

```bash
npi [options] [@files...] [messages...]
```

Common options:

| Option | Description |
|--------|-------------|
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output JSONL events |
| `--mode rpc` | Run the RPC protocol on stdio |
| `--model <pattern>` | Select a model, defaults to `noumena/kimi-2.7-coder` |
| `--provider <name>` | Provider, defaults to `noumena` |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh` |
| `--session <path\|id>` | Reuse a session |
| `--fork <path\|id>` | Fork a session |
| `--no-session` | Do not save session history |
| `--tools <list>` | Allow only selected tools |
| `--exclude-tools <list>` | Disable selected tools |
| `--no-builtin-tools` | Disable built-in tools |
| `--no-tools` | Disable all tools |
| `-e`, `--extension <source>` | Load an extension |
| `--skill <path>` | Load a skill |
| `--theme <path>` | Load a theme |

Examples:

```bash
npi
npi -p "Summarize this repository"
npi @README.md "Review this file"
npi --thinking high "Trace this bug"
npi --tools read,grep,find,ls -p "Inspect the code without editing"
```

## Files

| Path | Purpose |
|------|---------|
| `~/.npi/agent/settings.json` | User settings |
| `~/.npi/agent/auth.json` | OAuth credentials |
| `~/.npi/agent/sessions/` | Session history |
| `.npi/settings.json` | Project settings |
| `.npi/skills/` | Project skills |
| `.npi/prompts/` | Project prompt templates |
| `.npi/extensions/` | Project extensions |
| `.npi/themes/` | Project themes |

`AGENTS.md` and `CLAUDE.md` are still loaded as project context files.

## Build

From the repository root:

```bash
npm install --ignore-scripts
npm run check
npm --prefix packages/coding-agent run build:binary
./packages/coding-agent/dist/npi --help
```

The compiled Bun artifact is `packages/coding-agent/dist/npi`.

For isolated release artifacts:

```bash
npm run release:local -- --out /tmp/npi-local-release --force
/tmp/npi-local-release/node/npi --help
/tmp/npi-local-release/bun/npi --help
```

## Environment

| Variable | Description |
|----------|-------------|
| `NOUMENA_API_KEY` | Noumena API key |
| `NOUMENA_API_KEY_FILE` | File containing a Noumena API key |
| `NOUMENA_BASE_URL` | Override the Noumena OpenAI-compatible base URL |
| `CODE_STREAM_BASE_URL` | Legacy ncode-compatible base URL override |
| `NOUMENA_ISSUER_BASE_URL` | Override Noumena OAuth issuer |
| `NOUMENA_OAUTH_WEB_BASE_URL` | Override Noumena OAuth web flow URL |
| `NOUMENA_OAUTH_CLIENT_ID` | Override Noumena OAuth client ID |
| `NPI_CODING_AGENT_DIR` | Override `~/.npi/agent` |
| `NPI_CODING_AGENT_SESSION_DIR` | Override session storage |
| `NPI_OFFLINE` | Disable startup network operations |
| `NPI_SKIP_VERSION_CHECK` | Skip version update checks |
| `NPI_TELEMETRY` | Enable or disable install/update telemetry |

## License

MIT

## Attribution

npi is based on the MIT-licensed Pi mono repository by Mario Zechner and
earendil-works. The original Pi attribution and license are retained.
