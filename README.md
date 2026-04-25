# PropProfessor MCP

Standalone Model Context Protocol server for PropProfessor, plus a small query CLI for local analysis.

## What it provides

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

## Setup

```bash
npm install
```

You also need a saved PropProfessor browser session at `auth.json` in the repo root.
That session is created by logging into PropProfessor in a browser and saving the browser storage state.

## Run the MCP server

```bash
npm run mcp
```

The server speaks MCP over stdio.

## Query from the terminal

```bash
npm run query -- screen --league NBA --market Moneyline
npm run query -- tennis --market Moneyline --limit 10
npm run query -- health
```

## Repository layout

- `lib/propprofessor-api.js`, PropProfessor auth and request client
- `lib/propprofessor-analysis.js`, ranking and parsing helpers
- `scripts/propprofessor-mcp-server.js`, MCP stdio server
- `scripts/query-propprofessor.js`, terminal query CLI
- `test/`, node:test coverage for the API, MCP contract, and CLI

## Notes

- The client uses the saved PropProfessor cookies in `auth.json` to fetch a short-lived access token.
- The standalone repo intentionally keeps the surface area small so it is easy to install, test, and version independently.
