# Changelog

## 1.0.8

### Compact mode for screen/recommended/all_slates/staking_plan
- New `compact=true` param on `screen_ranked`, `screen`, `recommended_bets`, `all_slates`, and `staking_plan` tools. Strips each row to ~25 essential fields (no lineHistory, scoreBreakdown, full odds maps). Reduces response size by ~90%.
- When `compact=true`, history hydration (N+1 API calls to odds history endpoint) is skipped entirely, making compact queries 10-50x faster.
- `resultMeta.compact` flag indicates whether the response was compacted.

### `fields` param for selective field return
- New `fields: string[]` param on all screen/recommended/all_slates/staking_plan tools. Overrides `compact` when both are set.
- Example: `fields: ["game","selection","odds","edge","tier","kai"]` returns only those fields per row.
- `resultMeta.fields` lists the fields that were returned.

### `include` param for top-level metadata filtering
- New `include: string[]` param on all screen/recommended/all_slates/staking_plan tools.
- Values: `"freshness"`, `"warnings"`, `"resultMeta"`, `"league"`. Example: `include: ["resultMeta"]` returns only `ok`, `result`, and `resultMeta`.

### Response caching
- In-memory LRU cache with TTL (default 60s, configurable via `PROPPROFESSOR_CACHE_TTL_MS`).
- Max entries: 50, configurable via `PROPPROFESSOR_CACHE_MAX`.
- Cache hits reported via `resultMeta.cached: true`.
- Only caches full responses (not compact/fields-filtered).

### `get_play_details` MCP tool
- New tool: `get_play_details(league, game_ids)` — returns full rows (with line history, consensus, movement debug) for specific game IDs.
- Designed for the workflow: compact list → drill into selected plays.

### Lint cleanup
- Fixed 22 pre-existing lint errors across lib and test files (unused imports, duplicate keys, redundant Boolean casts).

## Unreleased

### `query_clv_history` MCP tool (Phase 7 of sharp-signal-tuning plan)
- New tool: reads a CSV bet log (default `~/Documents/bet-log.csv`, overridable via `path` arg or `BET_LOG_PATH` env var) and computes your actual CLV track record.
- Returns: `avgClv` (decimal-odds-ratio formula), `clvStddev`, `winRate`, `totalProfit`, `totalStake`, `roi`, and per-group breakdown (by `week`, `sport`, `tier`, or `book`).
- CSV format: `date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier` (header row required). `outcome` is `win`/`loss`/`push`.
- CLV formula: `(decimal_odds_taken / decimal_odds_close - 1) × 100` — works for both favorites and underdogs, positive when you beat the close.
- New file: `lib/propprofessor-clv-history.js` with `getClvHistory`, `readBetLog`, `computeClvPercent`, `computeProfit`, `americanToDecimal`, `groupBets`, `parseCsvLine`.
- Tests: 35 new in `test/propprofessor-clv-history.test.js` covering CSV parsing (including quoted fields with commas), CLV math (favorites, underdogs, negative cases, zero, non-finite), bet log validation (missing columns, invalid outcome, non-numeric odds), grouping by week/sport/tier/book, and the full `getClvHistory` flow.

### CLV multiplier in `query_staking_plan` (Phase 6 of sharp-signal-tuning plan)
- Stake sizing now applies a CLV multiplier in addition to the tier base and edge multiplier.
- Multiplier buckets: `clv >= 5%` → 1.5x, `2-5%` → 1.0x, `0.5-2%` → 0.75x, `< 0.5%` → 0.5x, missing/null → 0.5x.
- Formula: `stakePct = basePct × edgeMultiplier × clvMultiplier`, capped at 5% per play.
- New fields on each stake row: `clvPct`, `clvBucket`, `clvFactor`, `edgeFactor`, `basePct` so the breakdown is visible.
- `null`/`undefined` CLV is treated as "no data" (0.5x penalty) — not the same as CLV of 0.
- Tests: 16 new in `test/propprofessor-staking-clv.test.js`.

### Multi-window consensus score (Phase 2 of sharp-signal-tuning plan)
- New per-row field `multiWindowScore: 0.0-1.0` on every ranked screen row: fraction of [1h, 2h, 6h, 12h, 24h, 48h] time windows where all configured sharp books (Pinnacle, BetOnline, BookMaker) moved in the same direction.
- Companion fields: `consensusWindowCount`, `totalConsensusWindows`, `consensusWindows: string[]` (e.g. `["6h", "12h", "24h", "48h"]`), `multiWindowInsufficientData: bool`.
- **Movement grade:** `multiWindowScore >= 0.66` (>= 4 of 6 windows) is now required for GREEN eligibility. If `multiWindowInsufficientData` is true (no line history), the requirement is skipped — never punish absence of data.
- **Risk score:** `multiWindowScore >= 0.66` → -1, `<= 0.33` → +1, mid-range (0.34-0.65) → 0. Mid-range also demotes the grade (which has its own score effect).
- New function `computeMultiWindowScore(row, options)` in `lib/propprofessor-sharp-consensus.js` is callable independently and is also called by `rankScreenRows()`.
- New test file: `test/propprofessor-multi-window-score.test.js` (15 tests covering the function + risk grade integration).

### Steam detection tightened
- **Strict steam rule (Phase 1 of sharp-signal-tuning plan):** 5-minute window + 3+ sharp books (industry standard for genuine cross-book coordination). Was 1-hour window + 2+ books.
- New fields on every ranked screen row: `steamMoveLegacy`, `steamBooksLegacy`, `steamDirectionLegacy`, `steamBookCountLegacy` — keeps the old rule available for A/B comparison and rolling back if hit rates degrade.
- `steamMove` (the boolean driving `movementGrade`, risk score, +EV bonuses, and the +15 sharp-plays score bonus) now means **strict** steam only. Downstream scoring is unchanged — only the trigger condition is tighter.
- New test file: `test/propprofessor-steam-move-strict.test.js` (8 tests covering strict-only triggers, mixed directions, non-sharp book filtering, and side-by-side comparison).

## 1.0.7

### Screen API migration
- Migrated screen endpoint from `screen.propprofessor.com/api/retrieve-data-new` → `backend.propprofessor.com/screen`
- Now passes the full `ALL_SCREEN_BOOKS` list (36 books) by default, fixing non-major sports (Tennis, Soccer, etc.) returning only Polymarket data
- Added book name canonicalization via `canonicalizeScreenBookName()` with alias support (e.g. "rebet" → "Rebet", "propbuilder" → "Prop Builder")

### New analysis modules
- `propprofessor-steam-move.js` — Steam move detection integrated into screen ranking (exposes `steamMove`, `steamBooks`, `steamDirection` per row)
- `propprofessor-sharp-consensus.js` — Multi-window sharp consensus analysis across 1h/2h/6h/12h/24h/48h windows
- `propprofessor-best-price.js` — Line shopping: finds best price across all books for a given play

### New MCP tools (6)
- `query_sharp_consensus_windows` — Detect sustained sharp book consensus movement across time windows
- `query_all_slates` — Query 7+ leagues at once with consolidated ranked output
- `find_best_price` — Compare odds across all books for line shopping
- `get_hidden_bets` / `hide_bet` / `unhide_bet` / `clear_hidden_bets` — Fantasy bet hide/unhide CRUD
- `query_fantasy_picks` — Restored tool hitting `slipgen.propprofessor.com/fantasy-picks`
- `query_screen_odds_best_comps` / `query_screen_odds_ranked` — Explicit MCP tools for the screen ranking pipeline

### Sharp plays upgrades
- Steam bonus (+15pts) added to sharp play scoring
- Consensus-only fallback for execution books (Fliff, etc.) that can't validate independent sharp movement
- `requireIndependentSharpMovement` flag for flexible movement verification
- `lineHistoryUsable` surfaced in near-miss previews
- Removed `book: executionBook` override that was clobbering the actual book name in `sharp-plays-service`

### Screen ranking improvements
- `buildDegradedDataWarnings()` — Data quality transparency: warns when line history, consensus, or freshness is missing
- `recentWindowHours` now configurable via args (was hardcoded 6h)
- `getResolvedScreenSelection()` now matches by `selectionId` or exact `line+odds`, not just `defaultKey` (fixes prop selection mismatches)
- Steam move detection integrated into ranking pipeline

### Tennis two-phase fallback
- Phase 1: `/screen` with full book list (fixes Polymarket-only results)
- Phase 2: When `/screen` has insufficient data, falls back to +EV endpoint with odds history enrichment via `enrichTennisEvCandidates()`

### Handler renaming for consistency
All MCP tool handlers prefixed with `query_` for consistency:
- `ev_discover` → `query_positive_ev_candidates` (with mandatory `leagues` validation)
- `ev_validate` → `query_validated_positive_ev_candidates`
- `screen` → `query_screen_odds`
- `screen_raw` → N/A (removed as redundant)
- `sharp_plays` → `query_sharp_plays`
- `consensus_windows` → `query_sharp_consensus_windows`
- `ufc_card` → `query_ufc_card`
- `health` → `health_status`
- New per-league tools: `query_nba_screen`, `query_mlb_screen`, `query_nfl_screen`, `query_nhl_screen`, `query_ufc_screen`, `query_soccer_screen`, `query_ncaab_screen`, `query_ncaaf_screen`, `query_wnba_screen`, `query_sport_screen`
- CLI `ufc-card` command updated to call `query_ufc_card`

### Test coverage (+500 lines)
- Steam move detection and best-price analysis tests
- Prop selection resolution with multi-line alternates (Hartenstein O7.5 vs O8.5)
- Execution field preservation for selection2 rows (Spurs +5.5)
- `recentWindowHours` threading into movement summaries
- Book name canonicalization (ReBet aliases)
- 373 total tests, all passing

## 1.0.6

- Restored a raw `query_fantasy_picks` MCP tool for the live `/fantasy` optimizer / DFS board so fantasy availability no longer has to be inferred from `/screen`
- Reintroduced `queryFantasyPicks()` on the API client, posting directly to `https://slipgen.propprofessor.com/fantasy-picks` with the fantasy page referer
- Added regression coverage for the restored fantasy API helper and MCP tool-list / handler surface
- Added a reusable `sharp-plays-service` package export so PP-MCP business logic can be shared without importing the MCP script entrypoint
- Fixed `superjson` loading in the CommonJS API client by using a cached dynamic import, restoring Node 18 compatibility for TRPC hide-row serialization
- Added CI and local verification coverage across Node 18 and Node 20, including lint and Prettier checks
- Kept the release version ahead of the already-published `v1.0.5` tag so the next GitHub release can be tagged cleanly as `v1.0.6`

## 1.0.5

- Restored `query_positive_ev_candidates` as an MCP sportsbook discovery helper so Hermes can scan broad +EV candidates before validating finalists with `/screen`
- Added `query_validated_positive_ev_candidates` so PP-MCP can run sportsbook discovery plus built-in odds-history and sharp-movement validation in one MCP call
- Left `minValue` optional on the +EV MCP helpers so the frontend Positive EV screen can remain the source of truth when it already enforces `-3`
- Added MCP contract coverage for the restored +EV discovery tools, including `tools/list` parity, unset-`minValue` behavior, and validated ranking output
- Clarified README wording so the MCP surface is documented as screen-first with intentional sportsbook discovery and validation exceptions
- Added ranked response `debug=true|false` gating, defaulting to verbose debug metadata while allowing lean MCP and CLI payloads
- Added row-level `freshnessSource`, `freshnessAgeMs`, `freshnessFallbackUsed`, and `rankingProvenance` metadata for explainability and traceability
- Added `npm run smoke:live` for a lightweight live `/screen` ranked-response verification flow before tagging releases
- Shipped the sharp-history and ranked lookback work into the MCP ranked response path and export tooling
- Made `health_status` freshness ages non-null for populated screen payloads, with timestamp-source reporting and explicit fallback metadata when rows are undated
- Exposed richer ranked movement/debug metadata, including filtered history trails, dropped-point reasons, movement debug summaries, and lookback/result metadata
- Added bounded request timeouts across HTTP and TRPC calls so MCP and CLI requests fail predictably instead of hanging indefinitely
- Changed `query_validated_positive_ev_candidates` to use hybrid validation failure handling: partial validation returns warnings plus validation counts, while fully unvalidated requests fail explicitly
- Aligned `pp-query tennis` market expansion with the MCP tennis flow for spread and total aliases
- Hardened ranked preferred-book matching so regex-special characters in book names cannot crash ranking
- Added executable shebangs to the published `pp-mcp` and `pp-query` bin entrypoints

## 1.0.4

- Added configurable ranked odds-history lookback defaults via `PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS`
- Added per-request ranked lookback overrides through MCP `lookbackHours` and local CLI `--lookback-hours`
- Kept the default ranked odds-history window at 6 hours across MCP, library helpers, and local export/query scripts
- Tightened package metadata to describe the screen-first MCP surface and the broader local CLI split
- Synced package-lock metadata with package.json after the screen-only cleanup follow-up
- Added MCP regression coverage for removed fantasy tool names returning `Unknown tool`
- Fixed `pp-query sport` so it returns ranked screen output like `pp-query screen`
- Fixed `pp-query list` so the documented `list` command is included in the emitted command inventory

## 1.0.3

- Added WNBA sport support across the MCP server, CLI, and ranking presets
- Added a generic `query_sport_screen` MCP tool and `pp-query sport` CLI alias
- Added `pp-query list` and expanded CLI help to document the command inventory
- Tightened README wording and examples for the new sport aliases

## 1.0.2

- Public repo release polish
- Added standalone package metadata and CLI binaries
- Split setup into dedicated auth and config docs
- Added GitHub Actions CI and release automation
- Published v1.0.1 release and opened the repo for public access

## 1.0.1

- Initial standalone packaging of the PropProfessor MCP server and query CLI
- Added README, license, binary entrypoints, and GitHub release workflow
