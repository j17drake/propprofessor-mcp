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

1. Install the project
2. Run `pp-query install-auth --source /path/to/auth.json`
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

- `Find the best validated positive EV NBA plays available right now.`
- `Show me the top NHL moneyline opportunities.`
- `Check whether the PropProfessor MCP connection is healthy.`
- `Show me sharp plays with supportive book movement on NoVigApp.`

## Available MCP Tools

- `ev_discover` -- fast +EV candidate discovery from sportsbook endpoints
- `ev_validate` -- +EV candidates ranked with sharp-movement and odds-history validation
- `screen` -- ranked screen queries for any league (NBA, NFL, MLB, NHL, WNBA, UFC, Soccer, NCAAB, NCAAF, Tennis). Use `league` to pick the sport.
- `screen_raw` -- raw unranked screen payload for advanced use cases
- `sharp_plays` -- multi-league scanner for plays with supportive sharp book movement
- `ufc_card` -- UFC card shortlist with official plays, best looks, and passes
- `consensus_windows` -- multi-window sharp book consensus movement analysis
- `health` -- check auth freshness and endpoint connectivity

## CLI Commands

The local CLI still supports per-league shorthand commands:

- `pp-query doctor`
- `pp-query health`
- `pp-query screen --league NBA --market Moneyline`
- `pp-query nba --market Moneyline`
- `pp-query tennis --market Moneyline --limit 10`
- `pp-query sharp-plays --book Fliff --leagues NBA,MLB,NHL,Tennis --market Moneyline --limit 10`
- `pp-query ufc-card --book NoVigApp --market Moneyline`
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
