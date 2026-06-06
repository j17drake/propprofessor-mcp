# PropProfessor MCP — Improvement Plan

> Created: 2026-06-06
> Current version: 1.0.8
> Tests: 489/489 passing

---

## P0 — Compact mode missing critical movement fields

**Problem:** `COMPACT_FIELDS` strips `steamMove`, `steamBooks`, `steamDirection`, `consensusEdge`, `multiWindowScore`, `clvProxyPct`, `openingOdds`, `movementLabel`, and `movementSourceBook`. These are small fields (bools, numbers, short strings) that are essential for deciding whether to bet. Compact mode currently gives you the grade but not the underlying signals.

**Fix:** Add to `COMPACT_FIELDS` in `lib/propprofessor-mcp-ranked-screen.js`:
- `steamMove` (boolean, 1 byte)
- `consensusEdge` (number)
- `movementLabel` (short string)
- `clvProxyPct` (number)

**Impact:** Compact responses go from "grade only" to "grade + key signals" — makes compact mode actually useful for quick scanning.

**Files:** `lib/propprofessor-mcp-ranked-screen.js` (1 line change to array)

---

## P0 — Dead fields in COMPACT_FIELDS

**Problem:** `adaptiveConfidence`, `suppressed`, `suppressedBy` are in `COMPACT_FIELDS` but were removed with the self-improvement layer in v1.0.8. They're never populated — dead fields that waste tokens in every compact response.

**Fix:** Remove from `COMPACT_FIELDS`.

**Files:** `lib/propprofessor-mcp-ranked-screen.js`

---

## P1 — `get_play_details` doesn't enforce `skipHistory: false`

**Problem:** The handler hardcodes `compact: false` but spreads original args which may include `skipHistory: true`. Comment says "with history hydration — this is the detailed view" but doesn't enforce it. A user passing `skipHistory: true` would get a detail view without history — contradictory.

**Fix:** Change `args: { ...args, compact: false }` to `args: { ...args, compact: false, skipHistory: false }`.

**Files:** `scripts/propprofessor-mcp-server.js` (line ~845)

---

## P1 — No `lineHistorySummary` middle ground

**Problem:** `lineHistory` is the largest field per row (full array of odds points across books/time). It's always stripped in compact mode. There's no middle ground — you either get the full array or nothing.

**Fix:** Add a `lineHistorySummary` field to ranked rows in `lib/propprofessor-screen-utils.js`:
```js
lineHistorySummary: {
  opening: number,
  current: number,
  direction: 'drifted' | 'stable' | 'steam',
  points: number
}
```
Include `lineHistorySummary` in `COMPACT_FIELDS`.

**Impact:** Gives movement context without the full array. Small token cost.

**Files:** `lib/propprofessor-screen-utils.js`, `lib/propprofessor-mcp-ranked-screen.js`

---

## P2 — `sharp_plays` output doesn't include movement context in near-miss previews

**Problem:** `toNearMissPreview()` returns `lineHistoryUsable` (boolean) but not `movementLabel`, `steamMove`, or `consensusEdge`. When a play fails movement validation, you can't see *why* without a separate `get_play_details` call.

**Fix:** Add to `toNearMissPreview()`:
- `movementLabel`
- `steamMove`
- `consensusEdge`

**Files:** `lib/propprofessor-sharp-plays.js`

---

## P2 — CLI doesn't support `compact`/`skipHistory`/`fields`

**Problem:** `query-propprofessor.js` doesn't expose `compact`, `skipHistory`, or `fields` params. The CLI is used for local debugging — these would be useful for quick checks without firing up an MCP client.

**Fix:** Add CLI flags `--compact`, `--skip-history`, `--fields` to the `screen` and `sport` commands.

**Files:** `scripts/query-propprofessor.js`

---

## P3 — `recommended_bets` doesn't pass `skipHistory` to internal `screen_ranked` when called from `staking_plan`

**Already fixed** in commit `d16a90a`. Verified.

---

## P3 — Dependabot PRs (dev dependencies)

3 open PRs:
- `eslint` 9→10.4.1
- `globals` 15→17.6.0
- `@eslint/js` 9→10.0.1

ESLint 10 has breaking config changes. Test before merging.

---

## P4 — NoVigApp sharp validation gap (backend issue, not fixable in MCP)

**Known issue:** NoVigApp's vig-removed lines never match other books' exact lines, so `consensusBookCount = 0` and `lineHistoryUsable = false` for every NoVigApp row. This is a data mismatch between NoVigApp's pricing model and the sharp book comparison logic. The MCP correctly reports what the backend returns — no code fix possible on this side.

---

## Completed (this session)

- [x] `skipHistory` propagation in 4 handlers (`recommended_bets`, `staking_plan`, `all_slates`, `sharp_consensus`)
- [x] `sharp_plays` tier/verdict mismatch (green threshold accepts `playable`)
- [x] `recommended_bets` fallback when no TIER 1/2 plays exist
- [x] README/config alignment
- [x] Season-aware smoke test
- [x] Fliff data gap documented
- [x] Nitter RSS player context priority
- [x] Stale CHANGELOG cleanup
