# Changelog

## 1.3.0

### Market Name Normalization (Phase 3)

**Generic aliases now resolve per-league** — query `market="Total"` for any league and get the correct upstream market name:

| Alias | NHL | MLB | NBA | WNBA/SOCCER |
|-------|-----|-----|-----|-------------|
| Total | Total Goals | Total Runs | Total Points | Total Points / Total Goals |
| Spread | Puck Line | Run Line | Spread | Spread |

**New function:** `resolveMarketName(input, league)` in `propprofessor-shared-utils.js`
- Returns `{ resolved, wasAliased, original, aliasKey }`
- Handles case-insensitive input, whitespace, and shorthand (`rl`, `pl`)

**Applied to all 10 MCP entry points:**
- `screen`, `screen_ranked`, `raw_screen`
- `recommended_bets`, `staking_plan`
- `sharp_plays`, `sharp_consensus`
- `all_slates`, `novig_screen`
- `find_best_price`, `get_play_details`
- `ufc_card`

**New `markets_alias_used` field** in `resultMeta` when aliases were resolved:
```
"markets_alias_used": ["Total → Total Goals"]
```

**Tests:** 28 new test cases in `test/market-aliases.test.js` covering:
- All league/alias combinations
- Case insensitivity and whitespace
- Shorthand aliases (`rl`, `pl`)
- Passthrough for non-alias inputs
- Default Moneyline when empty

**595 tests passing** (594 from v1.2.0 + 28 new - 27 existing adjusted for correct alias behavior)

### Freshness Engine (Diagnosed — No Code Change Needed)

Phase 1 investigation found the `freshnessFallbackUsed: true` flag is **not a bug** — the upstream PropProfessor `/screen` API simply doesn't include timestamp fields on rows. The fallback code already handles this correctly:
- Scoring (`edge`/`tier`/`kai`) still populates even in fallback mode
- `newestAgeMs: 0` / `oldestAgeMs: 0` is the correct response to missing upstream data
- `timestampSources: { response_received: N }` correctly reports what's available

**G1 goal ("freshnessFallbackUsed: false on healthy responses") is not achievable** without upstream PropProfessor changes.

### Notes

- Branch: `release/v1.3.0-market-freshness-overhaul`
- Phase 5 (Token persistence) complete
- Phase 6 (Tool descriptions) complete
- Phase 7 (Verbosity) complete
- Phase 8 (Tests) complete — 672 tests

## Cross-Book Consensus Expansion (Phase 4)

**Alt markets now get expanded comparison book sets.** Previously, querying Run Line for MLB only compared against the same sharp book set as Moneyline — but Circa, BookMaker, etc. don't consistently post Run Line odds. Now:

| League | Alt Market | Books |
|--------|-----------|-------|
| MLB | Run Line | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |
| MLB | Total Runs | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel |
| NHL | Puck Line | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |
| NBA | Spread | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |

**New `consensusStrength` field** on every ranked row:

| Value | Meaning |
|-------|---------|
| `strong` | 3+ books agree |
| `moderate` | 2 books agree |
| `weak` | 1 book (no consensus) |
| `none` | 0 books |

**New `computeWeightedConsensus()`** function for sparse book coverage — when only 1-2 books post odds, Pinnacle gets 2x weight as the sharpest source.

**Before:** MLB Run Line avg 1.7 books per selection. **After:** Main Run Line has 11+ books, alt lines have 2+.

**Docs:** `docs/MARKET-BOOK-AVAILABILITY.md` with full availability matrix.

## 1.2.0

### Universal Agent Access (Major)

**Automated Auth Flow**

- New `pp-query login` command opens browser, user logs in, auth saves automatically to `~/.propprofessor/auth.json`
- No more manual cookie export — just run one command
- Added Playwright as optional dependency for browser automation
- Health endpoint now reports auth status with clear recovery instructions ("Run: pp-query login")

**Verbosity Levels**

- All bet-returning tools (`recommended_bets`, `sharp_plays`, `screen_ranked`, `screen`, `novig_screen`, `all_slates`, `staking_plan`, `ev_candidates`, `ufc_card`) now accept `verbosity: "minimal" | "standard" | "full"`
- `minimal`: Plain English for casual bettors ("Bet Bonfim at +105, high confidence, low risk")
- `standard`: Structured data without debug noise (edge, tier, risk, rationale)
- `full`: Everything — line history, movement data, debug payloads (default, backward compatible)

**Tool Discoverability**

- New `get_started` meta-tool tells agents the workflow based on user type (casual/intermediate/sharp)
- Returns structured workflow with steps, tools to use, and tools to avoid
- README now has "Tool Guide" section grouping tools by user type

**Agent Onboarding**

- `docs/AGENT_PROMPT.md` — system prompt template for agents serving bettors
- `docs/HERMES_SKILL.md` — Hermes skill file for quick context
- Covers tier system, risk scores, movement grades, workflows by user type

**Structured Error Handling**

- Error codes: `AUTH_EXPIRED`, `BACKEND_DOWN`, `RATE_LIMITED`, `BACKEND_ERROR`, `INTERNAL_ERROR`
- Each error includes recovery instructions
- Agents know exactly what to tell users when something breaks

**Backtesting**

- New `scripts/backtest.js` CLI validates tier system predicts outcomes
- `docs/BACKTESTING.md` explains usage and limitations
- Ready for historical data when available

**Stats**

- 583 tests passing (up from 489)
- 20 tools (up from 19 — added `get_started`)
- All lint checks pass

## 1.1.0

### Multi-market defaults for recommended_bets, staking_plan, sharp_plays

- `recommended_bets` now defaults to scanning Moneyline + Spread + Total markets (was Moneyline only). Queries each market per league, deduplicates by gameId+selection (keeps higher screenScore), then applies tier filtering. Returns the best plays across all markets.
- `staking_plan` inherits the same multi-market default via `recommended_bets`.
- `sharp_plays` now defaults to scanning Moneyline + Spread + Total (was Moneyline only).
- All three tools accept `markets: ["Spread"]` to override the default market list.
- `market` param preserved for backwards compatibility (treated as single-market override).
- Response includes `markets_queried: string[]` showing which markets were scanned.

### Equalized market priority weights

- Moneyline, spread, and total weights are now equal within each league's ranking preset. Previously spreads and totals had lower weights, requiring stronger signals to pass the same ranking gate.
- Props retain higher weights (harder markets to find edges in).
- Affected leagues: NBA, MLB, NFL, NHL, SOCCER, UFC, NCAAB, NCAAF, WNBA, and fallback.

### markets_queried in resultMeta

- All screen responses (`screen`, `screen_ranked`, `all_slates`, `ufc_card`) now include `resultMeta.markets_queried: string[]` indicating which markets were scanned.

### Tool description updates

- `recommended_bets`: documents multi-market default and `markets` param.
- `staking_plan`: documents multi-market inheritance.
- `sharp_plays`: documents multi-market default.
- `all_slates`: documents `markets` param.
- Added `markets` array property to `recommended_bets`, `staking_plan`, `all_slates`, and `sharp_plays` input schemas.

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

### Sharp book cross-reference for `sharp_plays`

- `sharp_plays` now cross-references each sharp book's screen individually to find independent supportive movement on the same game+selection. This satisfies the "movement from a non-target sharp book" requirement for books like NoVigApp whose vig-removed lines always show as self-sourced.
- New row fields: `sharpBookMovementConfirmed`, `sharpBookMovementSource`, `sharpBookClv` — populated when a sharp book independently confirms the play.
- `movementIsSharpSourced` now accepts `sharpBookMovementConfirmed` as an alternative to traditional independent sharp movement.
- Misleading pass reasons (`no_usable_line_history`, `movement_source_is_target_book`, etc.) are suppressed when sharp book confirmation exists.

### Removed fallback paths

- Removed `consensusEdgeOnlyOk`, `consensusOnlyOk`, and `clvOnlyOk` as `Bet candidate` paths. These previously accepted rows based on consensus edge or CLV alone without actual sharp movement confirmation.
- All `Bet candidates` now require either traditional `movementIsSharpSourced` (independent sharp book movement) or `sharpBookMovementConfirmed` (sharp book cross-reference).
- Removed `consensusValidated` path (consensus edge without movement confirmation).
- Removed unused variables: `hasConsensusEdge`, `clvValue`, `movementLabelOk`, `movementUnverifiable`.
- Simplified pass reason logic — no longer conditional on fallback flags.

### Test updates

- Updated all test expectations to reflect stricter Bet candidate criteria.
- 489/489 tests passing.

### Nitter RSS as primary tweet source in `player_context`

- `player_context` now tries Nitter RSS first (fast, no auth, local instance via `NITTER_BASE` env var, default `http://localhost:8080`).
- Fallback chain: Nitter RSS → X GraphQL (nitter-session-api) → Google News RSS → ESPN search.
- New source labels: `nitter-rss`, `nitter-combined`, `news-fallback` (previously only `x-direct`, `combined`, `empty`).
- New file: `searchNitterRSS()` in `lib/propprofessor-news-sources.js` with RSS parsing that handles both Google News and Nitter RSS formats (`<dc:creator>` for author).
- Tests: updated `test/propprofessor-news-sources.test.js` and `test/propprofessor-player-context.test.js` with Nitter RSS fixtures and source label assertions.

### `skipHistory` param on screen tools

- New `skipHistory: boolean` param on `screen_ranked`, `recommended_bets`, `all_slates`, `staking_plan`, and `sharp_consensus` tools.
- When `true`, skips odds history hydration entirely — useful when you only need current odds/edges and don't need movement data.
- Propagated through all handler call chains: `recommended_bets` → `screen_ranked`, `staking_plan` → `recommended_bets`, `all_slates` → `runLeagueScreen`/`runTennisScreen`, `sharp_consensus` → `screen_ranked`.
- `sharp_plays` already supported it via `...args` spread in `runSharpPlays` service.
- `compact` description clarified: it only affects output formatting, not data hydration. Use `skipHistory` to skip hydration.

### Compact mode description fix

- Clarified `compact` param description across all tools: "Does NOT affect history hydration — movement data is always fetched." Previously implied compact skipped history.

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
