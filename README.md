# PropProfessor MCP

Standalone Model Context Protocol server for PropProfessor, plus a small query CLI for local analysis.

## Install

```bash
npm install
```

## Usage

Run the MCP server over stdio:

```bash
npm run mcp
# or, if installed globally or via npm link
pp-mcp
```

Run the query CLI:

```bash
npm run query -- screen --league NBA --market Moneyline
# or
pp-query tennis --market Moneyline --limit 10
```

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

## Publishing

This repo is configured for npm packaging and private GitHub release tags.

- `main` points at the MCP server entrypoint
- `pp-mcp` and `pp-query` are exposed as binaries
- `npm test` runs the node:test suite

## Repository layout

- `lib/`, PropProfessor auth, requests, and analysis helpers
- `scripts/`, MCP stdio server and CLI
- `test/`, node:test coverage for the API, MCP contract, and CLI
