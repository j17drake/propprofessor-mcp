---
name: propprofessor-mcp
description: 'PropProfessor MCP: sports betting analysis for AI agents. Screens 36+ books, ranks by sharp movement, validates with multi-window consensus. Multi-market (ML/Spread/Total), market aliasing, consensus strength scoring.'
version: 1.4.0
author: James Drake
tags: [sports-betting, mcp, odds-analysis, sharp-movement]
---

# PropProfessor MCP — Agent Skill

## What It Does

PropProfessor is an odds analysis engine for AI agents. It screens 36+ sportsbooks, ranks plays by sharp-book consensus and multi-window line movement, enriches candidates with player-context research (news + tweets), and outputs tiered recommendations with Kelly-based staking. Supported leagues: NBA, MLB, NHL, WNBA, Tennis, UFC, Soccer, NCAAB, NCAAF, NFL.

## Quick Start

Pick the workflow that matches the user's sophistication.

### Casual bettor

```
get_started
  → quick_screen(books=[X], kaiCall=["BET"], sortBy="start", verbosity="minimal")
  → player_context(player=...)   # only if riskScore ≥ 7
```

Keep output to 2-3 sentences. Lead with the pick and odds. The `kaiCall` filter drops CONSIDER/PASS rows so the user only sees strong plays. `sortBy="start"` orders by game time (soonest first).

### Intermediate bettor

```
get_started
  → quick_screen(books=[X], kaiCall=["BET","CONSIDER"], sortBy="start", verbosity="standard")
  → player_context(player=...)   # for every TIER 1-2 candidate
  → find_best_price(league, market, game, selection)
```

Explain edge, movement grade, and where to shop the line. The two-tier filter drops PASS but keeps CONSIDER for users who want to see what sharp money is leaning toward.

### Sharp bettor

```
get_started
  → quick_screen(books=[X], kaiCall=["BET"], sortBy="riskScore", verbosity="full")
  → sharp_consensus(league, market, windows=[1,2,6,12,24,48])
  → sharp_plays(leagues=[...], targetBooks=[...], kaiCall=["BET"], sortBy="edge", sortDir="desc")
  → staking_plan(bankroll=N, leagues=[...])
```

Surface line-history detail, per-window consensus counts, and Kelly fractions. `sortBy="riskScore"` (default asc) orders by cleanest signal first. `sortBy="edge"` with `sortDir="desc"` ranks by largest consensus edge.

## Quick Recipes

**Today's plays on a specific book, soonest first (most common):**

```
quick_screen(books=["NoVigApp"], kaiCall=["BET"], sortBy="start", verbosity="minimal")
```

**Only the strongest, soonest games (TIGHTEST list):**

```
quick_screen(books=["Fliff"], kaiCall=["BET"], targetTiers=["TIER 1", "TIER 2"], sortBy="start", limit=10, verbosity="standard")
```

**Largest edge across all books, no PASS rows:**

```
quick_screen(kaiCall=["BET","CONSIDER"], sortBy="edge", sortDir="desc", verbosity="standard")
```

**Lowest-risk plays on a single book:**

```
quick_screen(books=["NovigApp"], kaiCall=["BET"], sortBy="riskScore", verbosity="standard")
```

**Validate one play before betting (drill-down):**

```
validate_play(league="NBA", gameId="...", selection="...", book="Fliff")
```

## Key Concepts

**Tier System (TIER 1–4)**
Confidence bucket combining edge, movement, and consensus. TIER 1 = lock-grade, TIER 2 = strong, TIER 3 = speculative, TIER 4 = pass. Never recommend TIER 4 as a bet.

**KaiCall (BET | CONSIDER | PASS)**
Layered action label derived from tier + risk + edge. BET = place it, CONSIDER = strong but monitor, PASS = skip. Use `kaiCall: ["BET"]` on any screen tool to filter out CONSIDER/PASS rows.

**`sortBy` Field**
Available on every screen-family tool. Accepts `start` (game time), `edge` (consensus edge), `tier` (TIER 1 first), `consensusBookCount` (most books first), `riskScore` (lowest first). Each has a sensible default direction. Missing-field rows always go to the end.

**Risk Score (1–10)**
Player/injury/news risk from `player_context`. 1-3 = clean, 4-6 = monitor, 7-10 = downgrade or skip. Always surface scores ≥ 7.

**Movement Grade (A–D)**
How many sharp books moved supportive across the lookback window. A = broad sharp support, D = no support or contradictory. Grade A/B with TIER 1-2 is the sweet spot.

**Multi-Market Defaults**

`recommended_bets`, `sharp_plays`, and `staking_plan` scan Moneyline, Spread, and Total by default. Pass `markets: ["Spread"]` to narrow. Market names are auto-aliased per league (e.g. "Total" → "Total Goals" for NHL, "Run Line" for MLB).

**Consensus Strength**

Each ranked row includes `consensusStrength`: `strong` (3+ books agree), `moderate` (2), `weak` (1), `none` (0). Use this to calibrate confidence — strong consensus + green movement = best signal.

**Verbosity Levels**

- `minimal` — essentials only (game, selection, odds, tier). For casual users.
- `standard` — adds edge, movement grade, kai call. Default.
- `full` — includes line history, score breakdown, full odds maps. For sharp users and debugging.

**Token Persistence**

Auth tokens are cached to `~/.propprofessor/token-cache.json`. Reduces login frequency. If tools return auth errors, tell user to run `pp-query login`.

## Common Pitfalls

- **Don't bet TIER 4.** It's a pass. Recommending it erodes trust.
- **Always check `player_context` before TIER 1-2 plays.** A high risk flag (injury, trade, scratch rumor) can invalidate an otherwise clean screen.
- **Don't over-explain to casual bettors.** They want the pick and the odds, not a dissertation on Pinnacle closing-line value.
- **Auth expiry → tell the user to run `pp-query login`.** You cannot refresh tokens yourself. When tools return 401/auth errors, surface this immediately.
- **`ev_candidates` returning 0 rows is normal on quiet days.** It's not a bug — it means no +EV opportunities pass the threshold. Don't retry or apologize; explain and move on.
- **`compact=true` strips line history.** If the user later asks "why did this move?", you'll need to re-query with `compact=false` or call `get_play_details` with the game IDs.

## Resources

- [`AGENT_PROMPT.md`](./AGENT_PROMPT.md) — full agent prompt with tool-by-tool guidance
- [`README.md#Quick Start`](../README.md#quick-start) — setup, install, auth, MCP client configs
- [`MARKET-BOOK-AVAILABILITY.md`](./MARKET-BOOK-AVAILABILITY.md) — which books post which markets
- [`CHANGELOG.md`](../CHANGELOG.md) — version history
