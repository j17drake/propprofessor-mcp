# PP-MCP Market Diversity Overhaul — Implementation Plan

**Goal:** Make spreads, totals, and other non-moneyline markets first-class citizens. No more moneyline-only defaults.

**Current version:** v1.0.8
**Target version:** v1.1.0 (multi-market default = feature change)

---

## Phase 1: Equalize Market Priority Weights

**File:** `lib/propprofessor-screen-utils.js` (presets object, lines ~273-442)
**Effort:** ~30 min | **Risk:** Low

### Problem
Spreads and totals have the lowest `weight` in every league's `marketPriorities`. This means a lower `sportScore` component, which means they need stronger consensus/movement signals to clear the same ranking gate as moneyline picks.

### Fix
Equalize all main-market weights within each league. Props stay higher (they should — harder to find edges, special tooling).

**Per-league weight changes:**

| League | Market | Old | New |
|--------|--------|-----|-----|
| NBA | moneyline | 1.4 | **1.5** |
| NBA | spread | 1.3 | **1.5** |
| NBA | total | 1.2 | **1.5** |
| MLB | moneyline | 1.5 | **1.5** (no change) |
| MLB | run line | 1.4 | **1.5** |
| MLB | total | 1.2 | **1.5** |
| NFL | moneyline | 1.5 | **1.5** (no change) |
| NFL | spread | 1.4 | **1.5** |
| NFL | total | 1.3 | **1.5** |
| NHL | moneyline | 1.5 | **1.5** (no change) |
| NHL | puck line | 1.4 | **1.5** |
| NHL | total | 1.25 | **1.5** |
| SOCCER | moneyline | 1.6 | **1.6** (no change) |
| SOCCER | spread | 1.5 | **1.6** |
| SOCCER | total | 1.45 | **1.6** |
| TENNIS | moneyline | 1.7 | **1.7** (no change) |
| UFC | moneyline | 1.8 | **1.8** (no change) |
| UFC | spread | 1.3 | **1.8** |
| NCAAB | moneyline | 1.4 | **1.5** |
| NCAAB | spread | 1.3 | **1.5** |
| NCAAB | total | 1.2 | **1.5** |
| NCAAF | moneyline | 1.5 | **1.5** (no change) |
| NCAAF | spread | 1.4 | **1.5** |
| NCAAF | total | 1.3 | **1.5** |
| WNBA | moneyline | 1.4 | **1.5** |
| WNBA | spread | 1.3 | **1.5** |
| WNBA | total | 1.2 | **1.5** |
| *fallback* | moneyline | 1.3 | **1.5** |
| *fallback* | spread | 1.2 | **1.5** |
| *fallback* | total | 1.1 | **1.5** |

### Tests to update
- `test/propprofessor-analysis.test.js` lines 558-562 — `getMarketPriorityScore` weight assertions will need new expected values.

---

## Phase 2: Multi-Market Default for `recommended_bets`

**File:** `scripts/propprofessor-mcp-server.js` (lines 760-840)
**Effort:** ~45 min | **Risk:** Medium

### Problem
`recommended_bets` queries one market per league call. Default is `'Moneyline'`. An agent asking "what should I bet today?" only ever sees moneylines.

### Fix
Query 3 markets per league (Moneyline, Spread, Total), merge results, then apply tier filtering. Return the best plays across ALL markets.

```js
// Before (line 764):
const market = args.market || 'Moneyline';

// After:
const markets = Array.isArray(args.markets) && args.markets.length
  ? args.markets
  : args.market
    ? [args.market]
    : ['Moneyline', 'Spread', 'Total'];
```

Then restructure the per-league loop to iterate markets:

```js
for (const league of leagues) {
  for (const market of markets) {
    const screenResult = await handlers.screen_ranked({
      league, market, /* ...existing args... */
    });
    // collect rows
  }
  // merge, deduplicate by gameId+selection, rank, filter by tier
}
```

Add `markets_queried` to the response:
```js
return {
  ok: true,
  totalRecommended: total,
  markets_queried: markets,  // ← new
  leagues: allRecommended.filter(l => l.count > 0),
  // ...
};
```

### Tests to update
- `test/propprofessor-mcp-server.test.js` — add test: default call returns plays across multiple market types; `markets_queried` present in response.

---

## Phase 3: Multi-Market Default for `staking_plan`

**File:** `scripts/propprofessor-mcp-server.js` (lines 843-859)
**Effort:** ~15 min | **Risk:** Low

### Problem
`staking_plan` calls `recommended_bets` internally with `args.market || 'Moneyline'`. Inherits the moneyline-only default.

### Fix
Same pattern as Phase 2:

```js
// Before (line 846):
const market = args.market || 'Moneyline';

// After:
const markets = Array.isArray(args.markets) && args.markets.length
  ? args.markets
  : args.market
    ? [args.market]
    : ['Moneyline', 'Spread', 'Total'];
```

Pass `markets` (not `market`) to the `recommended_bets` call. Add `markets_queried` to the staking plan response.

---

## Phase 4: Multi-Market Default for `sharp_plays`

**File:** `lib/propprofessor-sharp-plays.js` (line 128-130)
**Effort:** ~15 min | **Risk:** Low

### Problem
`resolveSharpPlayMarkets` defaults to `['Moneyline']`. Already supports arrays — just needs a new default.

### Fix
```js
// Before:
function resolveSharpPlayMarkets(args = {}) {
  return uniqueBooks(normalizeList(args.markets, args.market ? [args.market] : ['Moneyline']));
}

// After:
function resolveSharpPlayMarkets(args = {}) {
  return uniqueBooks(normalizeList(
    args.markets,
    args.market ? [args.market] : ['Moneyline', 'Spread', 'Total']
  ));
}
```

### Tests to update
- `test/propprofessor-sharp-plays.test.js` — verify default markets include Spread and Total.

---

## Phase 5: Update All Tool Descriptions

**File:** `lib/propprofessor-tool-definitions.js`
**Effort:** ~30 min | **Risk:** Zero (docs only)

### Changes

| Tool | Line | Change |
|------|------|--------|
| `recommended_bets` | ~368 | Add: "Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override." |
| `staking_plan` | ~414 | Add: "Defaults to scanning Moneyline, Spread, and Total markets via `recommended_bets`." |
| `sharp_plays` | ~221 | Add: "Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override." |
| `screen` | ~168 | Change: "Optional market filter, default Moneyline" → "Optional market filter. Default: Moneyline. For multi-market queries, use `screen_ranked` with `markets`." |
| `screen_ranked` | ~115 | Add: "Pass `markets: [\"Spread\", \"Total\"]` to scan multiple market types. Defaults to Moneyline only." |
| `all_slates` | ~299 | Change: "Market filter applied across all leagues, default Moneyline" → "Market filter. Default: Moneyline. Pass `markets` for multi-market scans." |
| `ufc_card` | ~338 | Add: "Pass `markets: [\"Total Rounds\"]` for round totals, etc." |

---

## Phase 6: Add `markets_queried` to All Screen Responses

**Files:** `lib/propprofessor-mcp-ranked-screen.js`, `scripts/propprofessor-mcp-server.js`
**Effort:** ~30 min | **Risk:** Low (additive)

### Problem
No way to tell from a response which markets were actually scanned.

### Fix
Add `markets_queried` to `resultMeta` in `buildRankedScreenResponse`:

```js
// In buildRankedScreenResponse, resultMeta object:
resultMeta: {
  // ...existing fields...
  markets_queried: args.markets
    ? args.markets
    : args.market
      ? [args.market]
      : ['Moneyline'],
}
```

For `recommended_bets` response, add at top level:
```js
return {
  ok: true,
  totalRecommended: total,
  markets_queried: markets,  // the array from Phase 2
  leagues: allRecommended,
  // ...
};
```

---

## Phase 7: CLI Default Update

**File:** CLI entry point (check `bin/pp-query.js` or equivalent)
**Effort:** ~15 min | **Risk:** Zero

### Fix
Make `pp-query screen --league NBA` and `pp-query all-slates` query multiple markets by default. Same pattern: default to `['Moneyline', 'Spread', 'Total']` unless `--market` is explicitly passed.

---

## Phase 8: Tests + Verification

**Effort:** ~1 hour | **Risk:** N/A

### Checklist
- [ ] Unit tests for weight changes (Phase 1) — update assertions in `propprofessor-analysis.test.js`
- [ ] Unit tests for multi-market `recommended_bets` (Phase 2) — new test in `propprofessor-mcp-server.test.js`
- [ ] Unit tests for multi-market `sharp_plays` (Phase 4) — new test in `propprofessor-sharp-plays.test.js`
- [ ] Contract test: `markets_queried` present in all screen responses (Phase 6)
- [ ] Full `npm test` — 489 tests must stay green
- [ ] `npm run lint` — 0 errors
- [ ] Live smoke: `screen(league="MLB", market="Spread")` returns spread-specific line data
- [ ] Live smoke: `recommended_bets(leagues=["MLB"])` returns plays across multiple market types
- [ ] Live smoke: `sharp_plays(leagues=["NBA"])` scans Spread and Total by default

---

## Phase 9: Bump + Release

**Effort:** ~15 min | **Risk:** Zero

1. `npm version minor` → v1.1.0
2. Update `CHANGELOG.md`:
   ```
   ## [1.1.0] — 2026-06-07
   ### Changed
   - `recommended_bets`, `staking_plan`, `sharp_plays` now default to scanning Moneyline + Spread + Total (was Moneyline only)
   - Market priority weights equalized across all main markets (spread/total no longer penalized)
   - All screen responses now include `markets_queried` in resultMeta
   - Tool descriptions updated to document multi-market defaults
   ```
3. `git push origin main --tags`
4. Verify CI green on GitHub Actions
5. Confirm release published

---

## Summary

| Phase | Files | Effort | Risk |
|-------|-------|--------|------|
| 1. Equalize weights | `propprofessor-screen-utils.js` | 30 min | Low |
| 2. Multi-market `recommended_bets` | `propprofessor-mcp-server.js` | 45 min | Medium |
| 3. Multi-market `staking_plan` | `propprofessor-mcp-server.js` | 15 min | Low |
| 4. Multi-market `sharp_plays` | `propprofessor-sharp-plays.js` | 15 min | Low |
| 5. Tool descriptions | `propprofessor-tool-definitions.js` | 30 min | Zero |
| 6. `markets_queried` metadata | `ranked-screen.js` + `server.js` | 30 min | Low |
| 7. CLI defaults | CLI entry point | 15 min | Zero |
| 8. Tests + verification | All test files | 1 hr | N/A |
| 9. Bump + release | `package.json` + CHANGELOG | 15 min | Zero |
| **Total** | **~8 files** | **~3.5 hrs** | — |

---

## Open Questions

1. **Should `screen` and `screen_ranked` also default to multi-market?** These are lower-level tools — agents typically call them with an explicit market. Probably keep them single-market by default but document that `markets` array is supported.

2. **Deduplication strategy for `recommended_bets`:** If the same game appears in both moneyline and spread results, do we return both picks or pick the higher-scored one? Recommendation: return both — they're different bets. Let the tier/score ranking sort them.

3. **API call volume:** 3 markets × 7 leagues = 21 screen calls per `recommended_bets` invocation (up from 7). The TTL cache helps, but initial calls will be slower. Consider adding a note in the description about using `compact: true` for faster responses.
