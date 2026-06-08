# PropProfessor MCP

<!-- Badges -->
[![npm version](https://img.shields.io/npm/v/propprofessor-mcp?color=44cc11&label=npm)](https://www.npmjs.com/package/propprofessor-mcp)
[![Release](https://img.shields.io/github/v/release/j17drake/propprofessor-mcp?color=44cc11)](https://github.com/j17drake/propprofessor-mcp/releases)
[![CI](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-583%20passing-44cc11)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-18%2B-44cc11)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Lean, fast odds analysis engine for AI agents. **20 tools, 583 tests, all performance features active.**

Screens 36+ sportsbooks across NBA, MLB, NHL, NFL, WNBA, UFC, Tennis, Soccer — ranks plays by sharp movement, consensus edge, and steam detection. Built for [Model Context Protocol](https://modelcontextprotocol.io) clients.

---

## What It Does

```
AI Agent → pp-mcp → PropProfessor API → Ranked plays with movement signals
```

1. **Screen** — Pull live odds across 36+ books, rank by sharp consensus + movement
2. **Validate** — Detect steam moves (5-min/3-book), multi-window consensus, CLV proxy
3. **Shop** — Line-shop across all books for best price
4. **Context** — Player news, tweets, injury risk flags before you bet
5. **Stake** — Fractional Kelly sizing with CLV-adjusted multipliers

---

## Quick Start

### Prerequisites

- Node.js 18+
- Paid [PropProfessor](https://propprofessor.com) account

### Install

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link
```

After `npm link`, two commands are available:

| Command | Purpose |
|---------|---------|
| `pp-mcp` | MCP server for AI agents (stdio transport) |
| `pp-query` | Local CLI for setup, debugging, quick checks |

### Auth Setup

**Option A: Automated login (recommended)**

```bash
pp-query login
```

This opens a Chromium browser, navigates to the PropProfessor login page, and waits for you to log in. Once you reach the dashboard, your session is automatically saved to `~/.propprofessor/auth.json`.

Requires playwright: `npm install --save-optional playwright && npx playwright install chromium`

**Option B: Manual cookie export**

```bash
pp-query install-auth --source /path/to/auth.json
```

Auth lookup order: `AUTH_FILE` env var → `~/.propprofessor/auth.json` → `./auth.json`

### Verify

```bash
pp-query doctor    # full setup check: Node, auth, endpoint
pp-query health    # quick endpoint ping
```

---

## Tool Guide

### For Casual Bettors (Just Tell Me What to Bet)

1. **`get_started`** (user_type: "casual") — Get the workflow
2. **`recommended_bets`** (verbosity: "minimal") — Plain English top picks
3. **`player_context`** — Check injury risk on specific plays

**That's it.** Three tools.

### For Intermediate Bettors (Show Me the Edge)

1. **`get_started`** (user_type: "intermediate") — Get the workflow
2. **`recommended_bets`** (verbosity: "standard") — Structured plays with edge/tier/risk
3. **`player_context`** — Injury risk check
4. **`find_best_price`** — Line shop across books
5. **`league_presets`** — See league-specific ranking weights

### For Sharp Bettors (Full Control)

1. **`get_started`** (user_type: "sharp") — Get the workflow
2. **`screen_ranked`** (verbosity: "full") — Complete ranked data
3. **`sharp_consensus`** — Multi-window sharp movement
4. **`sharp_plays`** — Plays with independent sharp support
5. **`get_play_details`** — Line history for specific plays
6. **`staking_plan`** — Kelly sizing
7. **`player_context`** — Injury risk on final picks

### All Tools (Reference)

| Tool | Purpose | Casual | Intermediate | Sharp |
|------|---------|--------|--------------|-------|
| `get_started` | Workflow guide | ✓ | ✓ | ✓ |
| `recommended_bets` | Top picks | ✓ | ✓ | ✓ |
| `player_context` | Injury risk | ✓ | ✓ | ✓ |
| `find_best_price` | Line shopping | | ✓ | ✓ |
| `league_presets` | Ranking weights | | ✓ | ✓ |
| `screen_ranked` | Full ranked data | | | ✓ |
| `sharp_consensus` | Multi-window movement | | | ✓ |
| `sharp_plays` | Independent sharp support | | | ✓ |
| `get_play_details` | Line history | | | ✓ |
| `staking_plan` | Kelly sizing | | | ✓ |
| `screen_raw` | Raw odds screen | | | ✓ |
| `ev_candidates` | +EV discovery | | | ✓ |
| `ufc_card` | UFC event analysis | | | ✓ |
| `all_slates` | All leagues at once | | | ✓ |
| `health_status` | System health | ✓ | ✓ | ✓ |
| `screen` | League screen | | | ✓ |
| `novig_screen` | NoVigApp-specific screen | | ✓ | ✓ |
| `hide_bet` / `unhide_bet` | Manage hidden bets | | ✓ | ✓ |
| `clear_hidden_bets` | Reset hidden bets | | ✓ | ✓ |

---

## MCP Client Setup

### Hermes Agent

```yaml
mcp_servers:
  propprofessor:
    command: node
    args:
      - /path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js
    enabled: true
    env:
      AUTH_FILE: /path/to/.propprofessor/auth.json
      PROPPROFESSOR_MCP_NDJSON: 'true'
```

Optional token compression for smaller context usage: install `caveman-shrink` globally, set `command: caveman-shrink`, and add `node` + server path to `args`.

### Claude Desktop / Cursor / Cline / Zed

See [CONFIG.md](CONFIG.md) for client-specific configs. The server runs via:

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

---

## Available MCP Tools (19)

### Screening & Ranking

| Tool | Description |
|------|-------------|
| `screen_ranked` | **Primary.** Hydrated ranked rows with consensus, movement, freshness. Supports `compact`, `fields`, `include`, `skipHistory`. |
| `screen` | League-specific ranked rows (NBA, MLB, NHL, NFL, WNBA, UFC, Soccer, NCAAB, NCAAF, Tennis). |
| `screen_raw` | Raw odds payload. `bestComps: true` for sharper comparison books. |
| `all_slates` | Consolidated ranked list across multiple leagues. |
| `get_play_details` | Full detail (line history, consensus, movement) for specific game IDs. Use after `compact` screen query. |

### Sharp Movement

| Tool | Description |
|------|-------------|
| `sharp_plays` | Target-book plays with **independently confirmed** sharp movement. Cross-references Pinnacle, Circa, BookMaker, BetOnline to verify supportive movement on the same game+selection. Only returns `Bet candidate` when a non-target sharp book confirms the move. |
| `sharp_consensus` | Multi-window (1h–48h) sharp book consensus analysis. |

### Line Shopping

| Tool | Description |
|------|-------------|
| `find_best_price` | Every book's odds sorted best→worst with spread from best price. |

### Player Context

| Tool | Description |
|------|-------------|
| `player_context` | News, tweets, riskFlag for a player. Nitter RSS → X → Google News RSS → ESPN fallback. Source authority scoring. |

### Betting

| Tool | Description |
|------|-------------|
| `recommended_bets` | TIER 1/2 plays across leagues with movementGrade, riskScore, kaiCall, rationale. |
| `staking_plan` | Fractional Kelly stakes (TIER 1=2%, TIER 2=1% of bankroll). |
| `ev_candidates` | Fast +EV discovery (secondary; validate on `/screen`). |

### UFC

| Tool | Description |
|------|-------------|
| `ufc_card` | First-class shortlist with official plays, best looks, passes. |

### Bet Management

| Tool | Description |
|------|-------------|
| `hide_bet` / `unhide_bet` | Toggle fantasy optimizer visibility per bet. |
| `get_hidden_bets` / `clear_hidden_bets` | List or clear all hidden bets. |

### Meta

| Tool | Description |
|------|-------------|
| `health_status` | Auth freshness, endpoint connectivity. |
| `league_presets` | Sport-specific ranking presets. |

---

## Performance Flags

All screen/recommended/staking tools support these params:

| Flag | Effect |
|------|--------|
| `compact: true` | ~90% smaller response. Retains movement signals (steamMove, consensusEdge, movementLabel). Does NOT skip history hydration. |
| `skipHistory: true` | Skips odds history hydration entirely. Use when you only need current odds/edges. |
| `fields: ["game","selection","odds","edge","tier","kai"]` | Selective field return (overrides `compact`). |
| `include: ["resultMeta"]` | Top-level section filtering. |

---

## Example Agent Prompts

```
Find top NBA moneyline plays on screen right now (compact=true).
Show TIER 1/2 plays across NBA, MLB, NHL with player context for top 3.
Scan Fliff/NoVigApp sharp plays with supportive movement (includePasses=true).
What's the best price for Lakers moneyline across all books?
Get full line history for game ID 12345 on NBA screen.
```

---

## CLI Commands

```bash
pp-query login                           # automated browser login (requires playwright)
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

---

## Book Configuration

The MCP uses three book categories:

### 1. Target Execution Books (your betting books)

Books you actually place bets on. Pass to `sharp_plays`, `recommended_bets`, `screen`:

```json
{ "targetBooks": ["Fliff", "NoVigApp", "Rebet"] }
```

### 2. Sharp Comparison Books (movement detection)

Books whose line movement signals sharp action. Pass to `sharp_plays`, `sharp_consensus`, `screen_ranked`:

```json
{ "sharpBooks": ["Pinnacle", "Circa", "BookMaker", "BetOnline"] }
```

### 3. Display Books (line shopping)

Books to show in `find_best_price` or `screen_raw`:

```json
{ "books": ["Pinnacle", "FanDuel", "DraftKings", "NoVigApp"] }
```

### Default Sharp Sets (Per Sport/Market)

Pre-configured in `lib/propprofessor-sharp-books.js`:

| Sport | Main Market | Props |
|-------|-------------|-------|
| **NBA** | Circa, Pinnacle, BookMaker, BetOnline, DraftKings | FanDuel, BookMaker, PropBuilder, NoVigApp, Pinnacle |
| **NFL** | Circa, Pinnacle, BookMaker, NoVigApp, FanDuel | Pinnacle, FanDuel, BookMaker, Circa, BetOnline |
| **MLB** | Pinnacle, Circa, BookMaker, BetOnline, DraftKings, BetMGM | Circa, FanDuel, PropBuilder, Pinnacle, DraftKings, Bet365 |
| **Others** | Pinnacle, Polymarket, Kalshi, BetOnline, Circa | Same |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_FILE` | `~/.propprofessor/auth.json` | Auth file path |
| `PROPPROFESSOR_MCP_NDJSON` | (required) | Enable NDJSON framing |
| `PROPPROFESSOR_CACHE_TTL_MS` | `60000` | Response cache TTL (ms) |
| `PROPPROFESSOR_CACHE_MAX` | `50` | Max cache entries (LRU) |
| `LOCAL_TIMEZONE` | `America/Chicago` | CLI display timezone |

---

## Known Issues

| Issue | Fix |
|-------|-----|
| `pp-query doctor` auth missing | Export fresh session to `~/.propprofessor/auth.json` |
| Endpoint check fails | Session stale — re-login and re-export |
| MCP client won't start | Run `pp-query doctor`; ensure `caveman-shrink` on PATH if using Hermes config |
| Large responses timeout | Use `compact: true` and/or `fields` param |
| No Bet candidates returned | Sharp book cross-reference requires overlap between target book and sharp book screens. Try different `sharpBooks` or check `emptyState.failureBreakdown` for reasons. |
| ChatGPT | Not supported for local stdio; use remote MCP endpoint |

---

## Verified Runtime Behavior (2026-06-06)

| Tool | Status | Notes |
|------|--------|-------|
| `screen` / `screen_ranked` | Healthy | Primary discovery path |
| `sharp_plays` | Healthy | Sharp book cross-reference confirms NoVigApp/Fliff plays against Pinnacle, Circa, BookMaker, BetOnline. Only returns `Bet candidate` with independent sharp confirmation. |
| `recommended_bets` | Healthy | Returns 0 plays when no TIER 1/2 opportunities exist. Expected, not a bug. |
| `ev_candidates` | Healthy | Fast +EV discovery; validate with `/screen` |

---

## For Maintainers

- **Tests**: `npm test` (583 passing, includes live API integration tests)
- **Live smoke**: `npm run smoke:live` (requires `auth.json`)
- **Lint**: `npm run lint`
- **Format**: `npm run format:check`
- **Release**: Push a `v*` tag → GitHub Actions creates release automatically
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Tool definitions**: `lib/propprofessor-tool-definitions.js`

## License

[MIT](LICENSE)
