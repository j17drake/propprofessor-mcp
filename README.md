# PropProfessor MCP

Screen-first PropProfessor MCP server, plus a broader local query CLI for maintenance and analysis.

![npm version](https://img.shields.io/badge/version-1.0.5-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D18-339933)

## Workflow badges

[![CI](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Manual live smoke](https://github.com/j17drake/propprofessor-mcp/actions/workflows/manual-live-smoke.yml/badge.svg)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/manual-live-smoke.yml)
[![Release](https://github.com/j17drake/propprofessor-mcp/actions/workflows/release.yml/badge.svg)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/release.yml)

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

This repo now exposes a mostly screen-first MCP surface, with intentionally restored sportsbook discovery helpers. The `query_positive_ev_candidates` MCP tool is available as a fast +EV finder, and `query_validated_positive_ev_candidates` adds the built-in odds-history and sharp-movement validation pass. Validated +EV queries now use hybrid failure handling: partially validated candidate sets return ranked results plus warning metadata, while requests where no candidates could be validated fail explicitly instead of silently degrading. Smart money inspection stays available in the local query client, while hidden-bet mutation flows remain underlying library helpers rather than public CLI commands.

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

Runtime behavior:

- PropProfessor HTTP and TRPC requests use bounded timeouts and retry retryable failures instead of hanging indefinitely
- `query_validated_positive_ev_candidates` returns `warnings` and validation counts when only part of the candidate set can be validated
- `query_validated_positive_ev_candidates` returns an error when zero candidates can be validated

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

## Manual live smoke workflow

This repo includes a manual GitHub Actions workflow for a live smoke check.

Before running it, add this repository secret:

- `PROPPROFESSOR_AUTH_JSON`, the full contents of a working `auth.json`

Then run the `manual-live-smoke` workflow from the Actions tab.
It installs dependencies, writes `auth.json` from the secret, and runs:

```bash
npm run smoke:live
```

## Release checklist

Before creating a new GitHub release:

1. Update the version in `package.json`
2. Add the matching heading in `CHANGELOG.md`
3. Run `npm test`
4. Run `npm run check:version`
5. Run `npm run smoke:live`
6. Create and push the git tag
7. Publish the GitHub release from that tag

## pp-query command inventory

The local `pp-query` CLI intentionally keeps a broader maintenance surface than the MCP server. Use the MCP server for screen-first ranked queries, and use `pp-query` when you want local-only helpers for sportsbook and smart money inspection or local ranked screen workflows.

- `opinion`, analyze a single prop from the sportsbook screen
- `sportsbook`, fetch sportsbook +EV rows
- `smart`, fetch smart money rows
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

The MCP server stays screen-first, with restored sportsbook discovery helpers for +EV candidate generation and validation. These are the full tool names it now exposes:

- `query_positive_ev_candidates`
- `query_validated_positive_ev_candidates`
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

`query_validated_positive_ev_candidates` response metadata now includes `validatedCount`, `failedValidationCount`, `historyFailureCount`, and `partialValidation` so callers can distinguish fully validated results from degraded-but-usable responses.

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
