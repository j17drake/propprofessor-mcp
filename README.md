# PropProfessor MCP

Standalone Model Context Protocol server for PropProfessor, plus a small query CLI for local analysis.

## Quick start

- [Auth guide](./AUTH.md)
- [Config guide](./CONFIG.md)


```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
```

You also need a saved PropProfessor browser session at `auth.json` in the repo root.
That file is ignored by git, so copy it from your existing setup or save a fresh browser session into this repo.

## Run locally

Run the MCP server over stdio:

```bash
npm run mcp
# or, after npm link
pp-mcp
```

Run the query CLI:

```bash
npm run query -- screen --league NBA --market Moneyline
# or
pp-query tennis --market Moneyline --limit 10
```

## npm link workflow

If you want the binaries available on your PATH while developing:

```bash
npm link
pp-mcp
pp-query health
```

## MCP config example

Add this to your Hermes or Claude MCP config when you want to use the local repo:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "pp-mcp",
      "args": [],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

If you prefer a direct repo path instead of a global link, use the local file path to `scripts/propprofessor-mcp-server.js` as the command target in your MCP launcher.

## Available tools

- `query_screen_odds`
- `query_fantasy`
- `query_fantasy_sorted`
- `query_screen_odds_best_comps`
- `query_screen_odds_ranked`
- `query_tennis_screen`
- `hide_fantasy_row`
- `hide_ev_row`
- `get_hidden_bets`
- `unhide_bet`
- `clear_hidden_bets`
- `league_presets`
- `health_status`

## Requirements

- Node.js 18 or newer
- A saved PropProfessor browser session at `auth.json` in the repo root

## Packaging

This repo is set up for npm packaging and tagged GitHub releases.

- `main` points at the MCP server entrypoint
- `pp-mcp` and `pp-query` are exposed as binaries
- `npm test` runs the node:test suite

## Repository layout

- `lib/`, PropProfessor auth, requests, and analysis helpers
- `scripts/`, MCP stdio server and CLI
- `test/`, node:test coverage for the API, MCP contract, and CLI
