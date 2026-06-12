# Install

> For full documentation, see [README.md](README.md) and [SETUP.md](SETUP.md). This file is the 60-second version.

## Prerequisites

- Node.js 18+
- A hermes install at `~/.hermes/` (any profile)
- A paid PropProfessor account

## Steps

```bash
# 1. Clone + install Node deps
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link

# 2. Wire into hermes (idempotent)
make install

# 3. Authenticate with PropProfessor
pp-query login
# or: export AUTH_FILE=/path/to/auth.json
# 4. Verify
pp-query doctor
```

## What `make install` does

| Step                                                        | Command                            | Reversible?        |
| ----------------------------------------------------------- | ---------------------------------- | ------------------ |
| 1. Symlink `propprofessor-coach` skill                      | `python3 scripts/install.py skill` | ✓ `make uninstall` |
| 2. Register MCP server with hermes                          | `python3 scripts/install.py mcp`   | ✓ `make uninstall` |
| 3. Install default config to `~/.propprofessor/config.json` | runs as part of step 2             | ✓ delete the file  |

## What `make install-cron` adds

Registers a `propprofessor-alerts` cron job that runs every 1h, queries TIER 1 plays, and delivers to your home telegram channel. See [docs/cron-prompts/sharp-money-alert.md](docs/cron-prompts/sharp-money-alert.md) for the prompt.

## Troubleshooting

- **`hermes: command not found`** — install hermes first: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
- **Skill doesn't load** — check the symlink: `ls -la ~/.hermes/skills/propprofessor-coach`. Should point back to this repo's `skills/propprofessor-coach/`.
- **Auth errors at runtime** — run `pp-query login` or `pp-query doctor`.
