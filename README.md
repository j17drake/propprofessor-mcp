# PropProfessor MCP

Screen-first PropProfessor MCP server, plus a broader local query CLI for maintenance and analysis.

![npm version](https://img.shields.io/badge/version-1.0.5-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D18-339933)

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

This repo now exposes a strict screen-first MCP surface. Fantasy, sportsbook +EV, smart money, and hidden-bet mutation flows stay available only in the local query client or underlying library helpers, not the MCP contract.

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
# or
pp-query screen --league NBA --market Points
# or
pp-query sport --league WNBA --market Moneyline
# or
pp-query wnba --market Moneyline
```

You can also use these aliases directly:

- NBA, `query_nba_screen` or `pp-query nba`
- WNBA, `query_wnba_screen` or `pp-query wnba`
- MLB, `query_mlb_screen` or `pp-query mlb`
- NFL, `query_nfl_screen` or `pp-query nfl`
- NHL, `query_nhl_screen` or `pp-query nhl`
- Soccer, `query_soccer_screen` or `pp-query soccer`
- NCAAB, `query_ncaab_screen` or `pp-query ncaab`
- NCAAF, `query_ncaaf_screen` or `pp-query ncaaf`

## Runtime environment

Optional environment variables:

- `AUTH_FILE`, path to the saved PropProfessor auth session JSON
- `LOCAL_TIMEZONE`, display timezone for local CLI formatting, default `America/Chicago`
- `PROPPROFESSOR_MCP_NDJSON`, set to `true` to use NDJSON framing instead of `Content-Length`
- `PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS`, default ranked odds-history lookback window in hours, default `6`

Per-request overrides:

- MCP ranked tools accept `lookbackHours` and `debug`
- Local CLI helpers accept `--lookback-hours` or `--lookbackHours`, plus `--debug` or `--no-debug`

## npm link workflow

If you want the binaries available on your PATH while developing:

```bash
npm link
pp-mcp
pp-query health
```

## pp-query command inventory

The local `pp-query` CLI intentionally keeps a broader maintenance surface than the MCP server. Use the MCP server for screen-first ranked queries, and use `pp-query` when you want local-only helpers for sportsbook, smart money, or fantasy inspection.

- `opinion`, analyze a single prop from the sportsbook screen
- `sportsbook`, fetch sportsbook +EV rows
- `smart`, fetch smart money rows
- `fantasy`, fetch fantasy rows
- `tennis`, query and rank tennis screen rows
- `screen`, query any sport screen with `--league`
- `sport`, alias for `screen`, use `--league` to pick the sport
- `nba`, NBA screen shorthand
- `wnba`, WNBA screen shorthand
- `mlb`, MLB screen shorthand
- `nfl`, NFL screen shorthand
- `nhl`, NHL screen shorthand
- `soccer`, Soccer screen shorthand
- `ncaab`, NCAAB screen shorthand
- `ncaaf`, NCAAF screen shorthand
- `presets`, show the active league presets
- `list`, show the command inventory
- `health`, check auth and endpoint health

## MCP config example

Add this to your Hermes or Claude MCP config when you want to use the local repo:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "pp-mcp",
      "args": [],
      "env": {
        "NODE_ENV": "production",
        "PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS": "6"
      }
    }
  }
}
```

If you prefer a direct repo path instead of a global link, use the local file path to `scripts/propprofessor-mcp-server.js` as the command target in your MCP launcher.

## Available MCP tools

The MCP server is strict screen-only. These are the full tool names it now exposes:

- `query_screen_odds`
- `query_screen_odds_best_comps`
- `query_screen_odds_ranked`
- `query_sport_screen`
- `query_nba_screen`
- `query_wnba_screen`
- `query_mlb_screen`
- `query_nfl_screen`
- `query_nhl_screen`
- `query_soccer_screen`
- `query_ncaab_screen`
- `query_ncaaf_screen`
- `query_tennis_screen`
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
- `npm run smoke:live` performs a live authenticated ranked `/screen` smoke check before tagging a release

## Repository layout

- `lib/`, PropProfessor auth, requests, and analysis helpers
- `scripts/`, MCP stdio server and CLI
- `test/`, node:test coverage for the API, MCP contract, and CLI
