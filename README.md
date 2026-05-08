# PropProfessor MCP

Use PropProfessor from any MCP client.

This project gives you:

- `pp-mcp`, an MCP server for AI agents
- `pp-query`, a local CLI for setup checks and direct testing

If you are new here, the fastest path is:

1. Install the project
2. Save your PropProfessor browser session to `~/.propprofessor/auth.json`
3. Run `pp-query doctor`
4. Add `pp-mcp` to your MCP client

## What It Does

This MCP lets an AI agent query PropProfessor data for things like:

- validated positive EV candidates
- ranked sport screens
- league-specific screens such as NBA, MLB, NFL, and tennis
- basic health checks

You do not need to understand the internal tool names to get started.

## What You Need

- Node.js 18 or newer
- A PropProfessor account
- A saved logged-in browser session for PropProfessor

## Install

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link
```

After `npm link`, these commands are available on your PATH:

- `pp-mcp`
- `pp-query`

## Set Up Auth

Save your PropProfessor browser session JSON at:

```bash
~/.propprofessor/auth.json
```

This is the default location the project now checks first.

Auth lookup order:

1. `AUTH_FILE`
2. `~/.propprofessor/auth.json`
3. `auth.json` in this repo

If you want to use a different location, set `AUTH_FILE`.

More detail: [AUTH.md](./AUTH.md)

## Verify It Works

Run:

```bash
pp-query doctor
```

That command checks:

- your Node version
- whether an auth file was found
- which auth path is being used
- whether PropProfessor responds

You can also run:

```bash
pp-query health
```

## Add It To Your MCP Client

Basic config:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "pp-mcp",
      "args": [],
      "env": {
        "PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS": "6"
      }
    }
  }
}
```

If your client wants a direct path instead of a linked binary:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": [
        "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"
      ]
    }
  }
}
```

More examples: [CONFIG.md](./CONFIG.md)

## Example Prompts

Try these in your MCP client:

- `Find the best validated positive EV NBA plays available right now.`
- `Show me the top NHL moneyline opportunities.`
- `Check whether the PropProfessor MCP connection is healthy.`
- `Rank today's tennis moneyline opportunities.`

## Start Here Tools

If you want a short list of the most useful MCP tools first:

- `query_validated_positive_ev_candidates`
  Best default for ranked, validated candidate discovery.
- `query_nba_screen`
  Simple sport-specific ranked screen query.
- `query_sport_screen`
  Same idea, but works across leagues.
- `health_status`
  Good for connection troubleshooting.

## CLI Commands

The local CLI is mainly for setup checks and quick direct testing.

- `pp-query doctor`
- `pp-query health`
- `pp-query screen --league NBA --market Moneyline`
- `pp-query nba --market Moneyline`
- `pp-query tennis --market Moneyline --limit 10`
- `pp-query list`

## Full MCP Tool List

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

## Troubleshooting

If `pp-query doctor` says auth is missing:

- make sure you saved your logged-in PropProfessor browser session
- put it at `~/.propprofessor/auth.json`
- or set `AUTH_FILE` to the correct path

If `pp-query doctor` finds auth but the endpoint check fails:

- your session may be stale
- log in again and export a fresh session file

If your MCP client cannot start the server:

- run `pp-query doctor`
- make sure `pp-mcp` is on your PATH
- if needed, use the direct `node /path/to/.../propprofessor-mcp-server.js` setup

## Advanced Settings

Environment variables:

- `AUTH_FILE`, override the auth file path
- `LOCAL_TIMEZONE`, local CLI display timezone, default `America/Chicago`
- `PROPPROFESSOR_MCP_NDJSON`, set to `true` for NDJSON framing
- `PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS`, default odds-history lookback window in hours, default `6`

Per-request overrides:

- MCP ranked tools accept `lookbackHours` and `debug`
- local CLI helpers accept `--lookback-hours` or `--lookbackHours`
- local CLI helpers also accept `--debug` or `--no-debug`

## For Maintainers

Release and live smoke workflow notes have been moved to [MAINTAINERS.md](./MAINTAINERS.md).
