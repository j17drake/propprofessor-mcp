# Agent Guide — PropProfessor MCP

This is the reference for **AI agents** (Claude, Cursor, Hermes, etc.) using
PropProfessor MCP. It covers the 5 patterns you'll actually need. The tool
surface is large (33 tools) on purpose — each does one sharp-money job — but
you only need a handful for 95% of workflows.

> **Golden rule:** `TIER 1-4`, `kaiCall` (BET/CONSIDER/PASS), `edge`, and
> `screenScore` are **quality ratings on what sharp books are doing** — NOT
> win-probability predictions. TIER 1 means sharp books agree; it does NOT
> mean the side will win. Use to inform handicapping, not to outsource
> decisions.

---

## Pattern 1 — "What should I bet today?"

Start here. One call returns the sharp slate, your pending picks, and your
recent stats.

```
today({ leagues: ["WNBA","NBA"], book: "NoVigApp", limit: 10 })
```

- `slate[]` — top plays by consensus edge, each with `tier`, `kai`, `edge`
- `pendingPicks[]` — your logged bets still awaiting settlement
- `stats` — your lifetime win rate / P&L (from `get_pick_stats`)
- `summary` — one-line string for a status report

If you don't know the user's context yet, call `ask({ query })` instead — it
parses natural language and executes the right tool in one shot:

```
ask({ query: "best WNBA play on NoVigApp tonight" })
```

---

## Pattern 2 — Validate a play before recommending it

After you have a candidate (from `today`, `quick_screen`, or `recommended_bets`),
run `validate_play` to get a verdict with a plain-English `actionableSummary`.

```
validate_play({
  league: "WNBA",
  gameId: "WNBA:PREMATCH:NYL:LV:123",
  selection: "Liberty -4.5",
  market: "Spread",
  book: "NoVigApp"
})
```

Returns:
- `verdict` — `BET` | `CONSIDER` | `PASS`
- `verdictSummary.actionableSummary` — read THIS to the user; don't cross-reference 5 fields
- `movementDisposition` — `sharp`, `neutral`, `fade`, `unknown`
- `riskFlags[]` — concrete cautions

If `verdict === "PASS"`, do NOT recommend the bet. Say why (use `riskFlags`).

---

## Pattern 3 — Place a bet (validate + log in one call)

`place_bet` runs `validate_play`, and if the verdict is `BET`/`CONSIDER`, logs
the pick and returns a `pickId` for later settlement. If `validate_play`
returns `PASS`, the bet is **rejected up front** — nothing is logged.

```
place_bet({
  league: "WNBA",
  gameId: "WNBA:PREMATCH:NYL:LV:123",
  selection: "Liberty -4.5",
  market: "Spread",
  book: "NoVigApp",
  stake: 50
})
```

Returns:
- `ok: true` + `pickId` — log succeeded, settle later with `resolve_pick`
- `ok: false`, `error.code: "BET_REJECTED"` — validate said PASS, with reasons
- `ok: false`, `error.code: "VALIDATION_FAILED"` — lookup/validation errored

> **Default stance:** never auto-place. Surface the `validate_play` verdict
> first, get the user's go-ahead, then call `place_bet`.

---

## Pattern 4 — Settle and learn

After the game, mark the pick and review performance:

```
resolve_pick({ id: "<pickId from place_bet>", result: "won" })
get_pick_stats({ days: 30 })      # win rate, P&L, by-league, by-tier
get_pick_history({ status: "pending" })  # what's still open
```

`get_pick_stats` returns `winRate`, `profit`, `byLeague`, `byTier` — use it to
tell the user what's working (e.g. "TIER 1 NBA is your best bucket at 58%").

---

## Pattern 5 — Market overview / deep dive

For a specific league's full board (not just the top picks):

```
quick_screen({ leagues: ["MLB"], book: "NoVigApp", limit: 20, validate: false })
```

For one game's full odds trail + player context:

```
get_play_details({ gameId: "MLB:PREMATCH:..." })
player_context({ player: "Ohtani", league: "MLB" })   # injury / availability
```

For sharp-money confirmation across Pinnacle/Circa/BookMaker/BetOnline:

```
sharp_plays({ league: "NBA", market: "Moneyline" })
smart_money({ league: "NBA", sportsbooks: ["Pinnacle","Circa"] })
```

---

## Anti-patterns

- **Don't call `log_pick` directly.** Use `place_bet` — it validates first and
  won't spam your history with PASS-grade non-bets.
- **Don't trust `TIER 1` as a win guarantee.** It's a sharp-agreement rating.
- **Don't skip `validate_play` before recommending.** The `actionableSummary`
  is what makes a recommendation defensible.
- **Don't fabricate odds.** Use `find_best_price` to get real numbers per book.

## Tool count

33 tools total (full mode). Lite mode (15 tools) is the curated set for
resource-constrained agents — it includes `ask`, `today`, `quick_screen`,
`validate_play`, `place_bet`, `recommended_bets`, and the tracking tools.
