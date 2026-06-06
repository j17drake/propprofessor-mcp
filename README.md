# PropProfessor MCP

Lean, fast odds analysis engine for AI agents. 19 tools, 487 tests, all performance features active.

## What Changed (v1.0.8)

- **Removed**: Self-improvement layer (memory, stats, adaptive filter, CLV history, Kelly staking)
- **Removed**: 4 MCP tools (`query_bet_stats`, `clv_history`, `record_outcome`, `record_feedback`)
- **Removed**: CLI commands `pp-query stats`, `pp-query calibration`
- **Retained**: Core odds analysis — screening, sharp movement, line shopping, player context, betting tools, UFC
- **Performance**: `compact: true` (90% smaller, 10-50x faster), `fields`/`include` params, TTL caching (60s), caveman-shrink token compression (~46%)

## Quick Start

### Prerequisites
- Node.js 18+
- Paid PropProfessor account at propprofessor.com
- Logged-in browser session exported as `auth.json`

### Install

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link
```

Commands available after `npm link`:
- `pp-mcp` — MCP server for AI agents
- `pp-query` — local CLI for setup/debugging

### Auth Setup

```bash
pp-query install-auth --source /path/to/auth.json
```

Auth lookup order:
1. `AUTH_FILE` env var
2. `~/.propprofessor/auth.json` (default)
3. `./auth.json` in repo

### Verify

```bash
pp-query doctor    # checks Node, auth, endpoint connectivity
pp-query health    # quick health check
```

## MCP Client Setup

### Hermes Agent

Example working Hermes config:

```yaml
mcp_servers:
  propprofessor:
    args:
    - /Users/jamesdrake/Documents/workspace/propprofessor-mcp/scripts/propprofessor-mcp-server.js
    command: node
    enabled: true
    env:
      AUTH_FILE: /Users/jamesdrake/.propprofessor/auth.json
      PROPPROFESSOR_MCP_NDJSON: 'true'
```

If you want token compression for smaller Hermes context usage, optional:
- install `caveman-shrink`
- set `command: caveman-shrink`
- use `args: ["node", "/Users/jamesdrake/Documents/workspace/propprofessor-mcp/scripts/propprofessor-mcp-server.js"]`

Reload Hermes after changing MCP config.

**Requirements**: `npm install -g caveman-shrink` (installs globally)

### Claude Desktop / Cursor / Cline

Use `CONFIG.md` for client-specific configs. The server runs via `node scripts/propprofessor-mcp-server.js` with `PROPPROFESSOR_MCP_NDJSON=true` and `AUTH_FILE` set.

### Generic stdio Client

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "AUTH_FILE": "/path/to/.propprofessor/auth.json",
        "PROPPROFESSOR_MCP_NDJSON": "true"
      }
    }
  }
}
```

## Available MCP Tools (19)

### Screening & Ranking
- `screen_ranked` — **Primary**. Hydrated ranked rows with consensus, movement, freshness. Supports `compact`, `fields`, `include`.
- `screen` — League-specific ranked rows (NBA, MLB, NHL, NFL, WNBA, UFC, Soccer, NCAAB, NCAAF, Tennis).
- `screen_raw` — Raw odds payload. `bestComps: true` for sharper comparison books.
- `all_slates` — Consolidated ranked list across multiple leagues.

### Sharp Movement
- `sharp_plays` — Target-book plays (Fliff, NoVigApp) with supportive non-target sharp movement.
- `sharp_consensus` — Multi-window (1h–48h) sharp book consensus analysis.

### Line Shopping
- `find_best_price` — Every book's odds sorted best→worst with spread from best price.

### Player Context
- `player_context` — News, tweets, riskFlag for a player. X + Google News RSS + ESPN fallback. Source authority scoring via watchlist.

### Betting
- `recommended_bets` — TIER 1/2 plays across leagues with movementGrade, riskScore, kaiCall, rationale.
- `staking_plan` — Fractional Kelly stakes (TIER 1=2%, TIER 2=1% of bankroll).
- `ev_candidates` — Fast +EV discovery (secondary; validate on `/screen`).

### UFC
- `ufc_card` — First-class shortlist with official plays, best looks, passes.

### Bet Management
- `hide_bet`, `unhide_bet`, `get_hidden_bets`, `clear_hidden_bets` — Fantasy optimizer tools.

### Meta
- `health_status` — Auth freshness, endpoint connectivity.
- `league_presets` — Sport-specific ranking presets.
- `get_play_details` — Full detail (line history, consensus, movement) for specific game IDs. Use after `compact` screen query.

## Verified Runtime Behavior (2026-06-06)

| Tool | Status | Notes |
|------|--------|-------|
| `screen` / `screen_ranked` | Healthy | Primary discovery path |
| `sharp_plays` | Healthy | Best for target-book value; returns `verdict`, `passReasons`, `movementGrade` |
| `recommended_bets` | Healthy | Returns 0 plays when no TIER 1/2 opportunities exist. This is expected, not a bug. |
| `ev_candidates` | Healthy | Fast +EV discovery; validate with `/screen` |

`recommended_bets` is functional. A 0-result response simply means there are no qualifying plays.

## Performance Flags (All Tools)

| Flag | Effect |
|------|--------|
| `compact: true` | ~90% smaller response, 10-50x faster (skips line history hydration) |
| `fields: ["game","selection","odds","edge","tier","kai"]` | Selective field return (overrides `compact`) |
| `include: ["resultMeta"]` | Top-level section filtering |

---

## Book Configuration

The MCP uses three book categories. Configure per-request via tool params:

### 1. **Target Execution Books** (your betting books)
Books you actually place bets on. Pass to `sharp_plays`, `recommended_bets`, `screen`:
```json
{ "targetBooks": ["Fliff", "NoVigApp", "Rebet"] }
```
**CLI**: `--book Fliff` or `--target-book Fliff` (single) / `--books Fliff,NoVigApp`

### 2. **Sharp Comparison Books** (movement detection)
Books whose line movement signals sharp action. Pass to `sharp_plays`, `sharp_consensus`, `screen_ranked`:
```json
{ "sharpBooks": ["Pinnacle", "Circa", "BookMaker", "BetOnline"] }
```

### 3. **Display Books** (line shopping)
Books to show in `find_best_price` or `screen_raw`. Defaults to all available:
```json
{ "books": ["Pinnacle", "FanDuel", "DraftKings", "NoVigApp"] }
```

### Default Sharp Sets (Per Sport/Market)
Pre-configured in `lib/propprofessor-sharp-books.js` — used when you don't override:

| Sport | Main Market | Props |
|-------|-------------|-------|
| **NBA** | Circa, Pinnacle, BookMaker, BetOnline, DraftKings | FanDuel, BookMaker, PropBuilder, NoVigApp, Pinnacle |
| **NFL** | Circa, Pinnacle, BookMaker, NoVigApp, FanDuel | Pinnacle, FanDuel, BookMaker, Circa, BetOnline |
| **MLB** | Pinnacle, Circa, BookMaker, BetOnline, DraftKings, BetMGM | Circa, FanDuel, PropBuilder, Pinnacle, DraftKings, Bet365 |
| **Others** | Pinnacle, Polymarket, Kalshi, BetOnline, Circa | Same |

**To override defaults**: Pass `books` or `sharpBooks` param to any tool. For persistent changes, edit `lib/propprofessor-sharp-books.js` constant arrays.

---

## CLI Commands

```bash
pp-query doctor                        # full setup check
pp-query health                        # quick health
pp-query screen --league NBA           # ranked screen
pp-query nba --market Moneyline        # league shorthand
pp-query tennis --limit 10             # tennis
pp-query sharp-plays --book Fliff      # sharp plays
pp-query ufc-card --book NoVigApp      # UFC card
pp-query all-slates                    # consolidated
pp-query presets                       # ranking presets
pp-query list                          # command inventory
```

## Example Agent Prompts

- `Find top NBA moneyline plays on screen right now (compact=true).`
- `Show TIER 1/2 plays across NBA, MLB, NHL with player context for top 3.`
- `Scan Fliff/NoVigApp sharp plays with supportive movement (includePasses=true).`
- `What's the best price for Lakers moneyline across all books?`
- `Get full line history for game ID 12345 on NBA screen.`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_FILE` | `~/.propprofessor/auth.json` | Auth file path |
| `PROPPROFESSOR_MCP_NDJSON` | (required) | Enable NDJSON framing |
| `PROPPROFESSOR_CACHE_TTL_MS` | `60000` | Response cache TTL (ms) |
| `PROPPROFESSOR_CACHE_MAX` | `50` | Max cache entries (LRU) |
| `LOCAL_TIMEZONE` | `America/Chicago` | CLI display timezone |

## Known Issues

- Fliff may have reduced coverage/line history versus other books, which can lower `sharp_plays` validation confidence even when other edges are strong.

| Issue | Fix |
|-------|-----|
| `pp-query doctor` auth missing | Export fresh session to `~/.propprofessor/auth.json` or set `AUTH_FILE` |
| Endpoint check fails | Session stale — re-login and re-export |
| MCP client won't start | Run `pp-query doctor`; ensure `caveman-shrink` on PATH if using Hermes config |
| Large responses timeout | Use `compact: true` and/or `fields` param |
| ChatGPT | Not supported for local stdio; use remote MCP endpoint |

## For Maintainers

- Tests: `npm test` (487 passing)
- Live tests: require `~/.propprofessor/auth.json`
- Release notes: `MAINTAINERS.md`
- Tool definitions: `lib/propprofessor-tool-definitions.js`