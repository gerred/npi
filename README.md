<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://code.noumena.com/logos/wordmark-light.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://code.noumena.com/logos/wordmark-dark.svg">
    <img src="https://code.noumena.com/logos/wordmark-dark.svg" alt="Noumena" width="260">
  </picture>
</p>

# npi

npi is a Noumena-specific fork of the Pi coding-agent harness. The built-in
runtime supports one provider and one model:

- Provider: `noumena`
- Model: `kimi-2.7-coder`
- Default API: `https://api.noumena.com/v1`

The CLI binary is `npi`, and the default config directory is `~/.npi/agent`.

## Status

npi is an unofficial community fork. It is not an official Noumena harness and
is not maintained by Noumena. For the official Noumena Code project, see
[Noumena-Network/code](https://github.com/Noumena-Network/code).

## Packages

| Package | Description |
|---------|-------------|
| `@gerred/npi-coding-agent` | Interactive coding-agent CLI |
| `@gerred/npi-ai` | Noumena-focused LLM API layer |
| `@gerred/npi-agent-core` | Agent runtime with tool calling and state management |
| `@gerred/npi-tui` | Terminal UI library |

## Install

```bash
npm install -g --ignore-scripts @gerred/npi-coding-agent
npi
```

Authenticate with Noumena OAuth from the TUI:

```text
/login
```

Or provide an API key:

```bash
export NOUMENA_API_KEY=...
npi
```

For ncode-compatible local key files:

```bash
export NOUMENA_API_KEY_FILE=~/.config/noumena/ncode/api_key
npi
```

## Build From Source

```bash
npm install --ignore-scripts
npm run check
npm --prefix packages/coding-agent run build:binary
./packages/coding-agent/dist/npi --help
```

The Bun binary artifact is written to `packages/coding-agent/dist/npi`.

To build isolated local release artifacts:

```bash
npm run release:local -- --out /tmp/npi-local-release --force
/tmp/npi-local-release/node/npi --help
/tmp/npi-local-release/bun/npi --help
```

## Development

```bash
npm install --ignore-scripts
npm run check
./test.sh
```

Do not run lifecycle scripts during dependency hydration unless the dependency
change has been reviewed.

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

## Attribution

npi is based on the MIT-licensed Pi mono repository by Mario Zechner and
earendil-works. The original Pi attribution and license are retained; this fork
keeps the original harness architecture while narrowing the supported provider
surface to Noumena.

## License

MIT
