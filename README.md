# PropProfessor MCP

Use PropProfessor from AI clients that support MCP.

This project gives you:

- `pp-mcp`, the MCP server for AI agents
- `pp-query`, the local CLI for setup checks and direct testing
- `sharp-plays-service`, the reusable package export for shared sharp-play orchestration

Works best with local MCP clients like Claude Desktop, Cursor, and Cline.

If you use ChatGPT, see the ChatGPT note below first. ChatGPT currently does not use this project the same way local `stdio` MCP clients do.

## Choose Your Client

| Client                   | Status            | Best path                                               |
| ------------------------ | ----------------- | ------------------------------------------------------- |
| Claude Desktop           | Best support      | Use the local `pp-mcp` server directly                  |
| Cursor                   | Best support      | Use `.cursor/mcp.json` with `pp-mcp` or `node`          |
| Cline                    | Supported         | Use `cline_mcp_settings.json` with `pp-mcp` or `node`   |
| ChatGPT                  | Alternative setup | Not a direct local `stdio` MCP path for this repo today |
| Generic local MCP client | Supported         | Use the generic `pp-mcp` config in `CONFIG.md`          |

## Quick Start

1. Make sure you have a paid PropProfessor account at propprofessor.com
2. Install the project
3. Run `pp-query install-auth --source /path/to/auth.json`
4. Run `pp-query doctor`
5. Add `pp-mcp` to your MCP client

## What It Does

This MCP lets an AI agent query PropProfessor data for things like:

- validated positive EV candidates
- ranked sport screens per league (NBA, MLB, NHL, NFL, WNBA, UFC, Tennis, Soccer, NCAAB, NCAAF)
- multi-league consolidated slates
- sharp plays with supportive book movement
- multi-window sharp consensus analysis
- steam move detection
- UFC card shortlists
- line shopping across all books
- fantasy picks availability and management
- basic health checks

You do not need to understand the internal tool names to get started.

## What You Need

- Node.js 18 or newer
- A paid PropProfessor account at propprofessor.com
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

Before exporting auth, sign in to your paid PropProfessor account in the browser you are exporting from.

Easiest option:

```bash
pp-query install-auth --source /path/to/auth.json
```

That copies your saved PropProfessor browser session into the default location:

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

If you do not already have an `auth.json`, see the export guide in [AUTH.md](./AUTH.md#how-to-export-authjson).

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

## Client Setup

### Claude Desktop

Claude Desktop is one of the best ways to use this project.

Use the Claude Desktop setup in [CONFIG.md](./CONFIG.md#claude-desktop), then try:

`Check whether the PropProfessor MCP connection is healthy.`

### Cursor

Cursor supports local `stdio` MCP servers directly.

Use the Cursor setup in [CONFIG.md](./CONFIG.md#cursor), then try:

`Check whether the PropProfessor MCP connection is healthy.`

### Cline

Cline supports local MCP servers through its MCP settings file.

Use the Cline setup in [CONFIG.md](./CONFIG.md#cline), then try:

`Check whether the PropProfessor MCP connection is healthy.`

### ChatGPT

ChatGPT supports MCP in a different way from local `stdio` MCP clients.

This repo is currently designed for local `stdio` MCP clients such as Claude Desktop, Cursor, and Cline. ChatGPT's MCP support is oriented around remote MCP servers and ChatGPT apps, not launching this local `pp-mcp` process directly.

If ChatGPT support is important to you, the recommended future direction is exposing this server as a remote MCP endpoint.

See [CONFIG.md](./CONFIG.md#chatgpt) for the short explanation.

### Generic Local MCP Client

If your client can launch a local `stdio` MCP server, use the generic setup in [CONFIG.md](./CONFIG.md#generic-local-mcp).

## Add It To Your MCP Client

If your client supports local `stdio` MCP servers, use the client-specific setup in [CONFIG.md](./CONFIG.md).

If your client is not listed, start with the generic local MCP config.

## Example Prompts

Try these in your MCP client:

- `Find the top NBA moneyline plays on screen right now.`
- `Show me the top NHL opportunities with Tier 1 or Tier 2 confidence.`
- `Scan all leagues and show me the top plays across NBA, MLB, and NHL.`
- `What does the UFC card look like this weekend?`
- `Show me sharp consensus movement on NFL spreads over the past 6 hours.`
- `Find the best price for Lakers vs Celtics moneyline across all books.`
- `Check whether the PropProfessor MCP connection is healthy.`
- `Show me sharp plays with supportive book movement on NoVigApp.`

## Available MCP Tools

All tool names use the `query_` prefix for consistency:

**Primary: `/screen`-based, actual playable lines**
- `query_screen_odds_ranked` — ranked screen query with consensus, movement, and freshness metadata
- `query_sport_screen` — ranked screen for any league (NBA, NFL, MLB, NHL, WNBA, UFC, Soccer, NCAAB, NCAAF, Tennis)
- `query_nba_screen`, `query_nfl_screen`, `query_mlb_screen`, `query_nhl_screen`, `query_ufc_screen`, `query_soccer_screen`, `query_ncaab_screen`, `query_ncaaf_screen`, `query_wnba_screen` — per-league ranked screen shortcuts
- `query_tennis_screen` — tennis-specific screen with two-phase fallback
- `query_all_slates` — query multiple active leagues at once with consolidated ranked output
- `query_ufc_card` — UFC card shortlist with official plays, best looks, and passes
- `find_best_price` — line shopping: show every book's odds sorted best to worst with spread from best price
- `query_sharp_plays` — multi-league scanner for plays with supportive sharp movement
- `query_sharp_consensus_windows` — multi-window sharp book consensus movement
- `query_fantasy_picks` / `get_hidden_bets` / `hide_bet` / `unhide_bet` / `clear_hidden_bets` — fantasy optimizer tools

**Secondary: research/override**
- `ev_candidates` — fast +EV candidate discovery from sportsbook endpoints (requires `leagues`). Use this when `/screen` is thin; validate finalists on `/screen`
- `query_screen_odds` — raw unranked screen payload for advanced analysis only
- `query_screen_odds_best_comps` — screen query with sharper default comparison book sets

**Meta**
- `league_presets` — show the current sport-specific ranking presets
- `health_status` — check auth freshness and endpoint connectivity

## CLI Commands

The local CLI still supports per-league shorthand commands:

- `pp-query doctor`
- `pp-query health`
- `pp-query screen --league NBA --market Moneyline`
- `pp-query nba --market Moneyline`
- `pp-query tennis --market Moneyline --limit 10`
- `pp-query sharp-plays --book Fliff --leagues NBA,MLB,NHL,Tennis --market Moneyline --limit 10`
- `pp-query ufc-card --book NoVigApp --market Moneyline`
- `pp-query consensus-windows --league Tennis --market Moneyline`
- `pp-query all-slates`
- `pp-query list`
- `pp-query presets`

## Troubleshooting

If `pp-query doctor` says auth is missing:

- make sure you saved your logged-in PropProfessor browser session
- put it at `~/.propprofessor/auth.json`
- or set `AUTH_FILE` to the correct path

If `pp-query doctor` finds auth but the endpoint check fails:

- your session may be stale
- log in again and export a fresh session file

If Claude Desktop, Cursor, or Cline cannot start the server:

- run `pp-query doctor`
- make sure `pp-mcp` is on your PATH
- if needed, use the direct `node /path/to/.../propprofessor-mcp-server.js` setup

If you use ChatGPT:

- this repo is not currently a direct local `stdio` ChatGPT setup
- the recommended future direction is exposing it as a remote MCP server
- until then, Claude Desktop, Cursor, and Cline are the easiest ways to use it

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
