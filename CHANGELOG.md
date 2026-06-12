# Changelog

## Unreleased

### Fixed

- **Spread alias wrong for basketball/football/soccer** (`lib/propprofessor-shared-utils.js` + `lib/propprofessor-sharp-books.js`). `MARKET_ALIASES.spread` and `.handicap` resolved to `"Spread"` for NBA/WNBA/NCAAB/NCAAF/NFL/SOCCER, but the live PropProfessor `/screen` endpoint serves those leagues as `"Point Spread"`. Every spread query on those leagues returned an empty payload. Discovered 2026-06-12 when a WNBA `novig_screen` with `markets=["Spread"]` returned 0 candidates but `find_best_price(market="Point Spread")` returned 19 books. Tennis was unaffected because `normalizeTennisMarketQuery()` expands `"Spread"` to `["Game Handicap", "Set Handicap", "Point Spread"]` before the screen call. `ALT_MARKET_BOOKS` keys renamed to match the new canonical name; 4 new regression tests added; README test count bumped 787 → 788.

## 2.1.0 — Hermes Plugin Conversion (Apollo-Style Install)

**This release adds the Apollo-style one-command install flow. No behavior change to the 23 MCP tools.**

### Added

- `make install` — one-command install: links the `propprofessor-coach` skill into hermes, registers the MCP server, installs the default config
- `make install-cron` — registers the optional `propprofessor-alerts` sharp-money cron
- `make uninstall` — reverses both
- `scripts/install.py` — idempotent Python installer (stdlib only, no pip deps)
- `scripts/install_helpers.py` + `scripts/test_install_helpers.py` — hermes path/profile resolution helpers with tests
- `bin/pp` — thin CLI wrapper for `pp hide / unhide / hidden / sync / doctor / today`
- `config.default.json` — ships sane defaults (league=NBA, bankroll=1000, targetBook=NoVigApp)
- `pp-query setup` — copies the default config to `~/.propprofessor/config.json`
- `skills/propprofessor-coach/SKILL.md` — operator-facing coach skill (auto-routes "what should I bet today" to the right tools)
- `docs/cron-prompts/sharp-money-alert.md` — cron prompt template
- `INSTALL.md` — 60-second quick-start

### Behavior

- The 23 MCP tools and 784-test suite are unchanged. Pure packaging work.
- `hermes mcp add propprofessor` is unchanged in shape — the installer just automates the config edit that users previously did manually.

### Migration

- Existing users: re-running `make install` is a no-op. New install gets the skill symlink + config.
- The 3 hermes-side `propprofessor-*` skills in `~/.hermes/skills/` are unchanged. The new coach skill ships in the repo and gets linked separately.

## 2.0.1

### Docs

Pre-directory polish. The README's polish checklist from v1.6.1 (repo description, Mermaid diagram, FAQ, docs map, install path verification) was already comprehensive. v2.0.1 ships two targeted fixes for drift:

- **FAQ "TIER 1 hit rate"** — updated from the v1.5.5-era 580-play sample to the current 575-play backtest count. Honest framing: hit rate sits around chance (~50%) on a ~575-play synthetic backtest. Numbers drift slightly with the random seed; the round claim is stable.
- **Status section "Latest release"** — was a generic pointer to the releases page. Now names v2.0.0 specifically with a one-line description of what it was, so directory visitors landing on the README see the most recent release at a glance.

Install path verification: `node scripts/propprofessor-mcp-server.js` boots clean, NDJSON framing works end-to-end, `initialize` + `tools/list` returns all 23 tools, `npm link --dry-run` confirms the `pp-mcp` / `pp-query` binaries would install. No code changes; no behavior change.

## 2.0.0

### Refactor

Lib organization, part 2 of 2. The 23 `createMcpHandlers()` tool implementations (~1,730 lines) are extracted from `scripts/propprofessor-mcp-server.js` into `scripts/server/handlers.js`. The JSON-RPC frame (`createMcpServer`) and the stdio serve loop stay in the entry point; `handlers.js` is a leaf that the entry re-exports from for backward compatibility with existing imports. Algorithm, tier system, and tool surface unchanged. No user-facing behavior changes.

### Bug fix

A v1.7.0 leftover from the planned-but-incomplete v2.0.0 refactor: the previous server file dropped its `module.exports` block, which would have broken every external importer (CLI scripts, tests, downstream tools). The v2.0.0 entry point restores the exports block and prunes 9 dead imports/consts the partial refactor had carried into `handlers.js` (`createJsonRpcSuccess`, `createJsonRpcError`, `encodeMessage`, `createStdioMessageReader`, `buildToolDefinitions`, `clearTierCache`, `SERVER_NAME`, `SERVER_VERSION`, `PROTOCOL_VERSION` — all server-level, none of which belong in a leaf module). `mapWithConcurrency` (a top-level helper) is also re-exported from the new leaf so existing test imports still resolve.

### Stats

- 784 tests passing (unchanged from 1.7.0)
- 23 tools (unchanged)
- TIER 1 hit rate: 51.5% on 575 plays (unchanged)
- TIER 4 ≤ TIER 2 inversion: still holds (49.7% ≤ 49.9%)
- Server entry: 1,861 → 158 lines
- New leaf: `scripts/server/handlers.js` (1,730 lines)
- Lib files: 31 (unchanged)

## 1.7.0

### Refactor

Lib organization, part 1 of 2. Structural cleanup with no user-facing behavior changes. The algorithm, tier system, and tool surface are unchanged.

- **Tennis files merged** — `lib/propprofessor-tennis-times.js` and `lib/propprofessor-tennis-names.js` → `lib/propprofessor-tennis.js`. Both files were tennis-specific helpers (player name resolution, ESPN-backed match time correction) that were needlessly split. The merged file has a single `module.exports` exposing the union of the old APIs: `PLAYER_NAMES`, `resolvePlayerName`, `getNameSlug`, `correctTennisTimes`, `fetchEspnMatches`, `nameSimilarity`, `formatCentralTime`, `isPlaceholderTime`. All import sites updated.

### Stats

- 784 tests passing (unchanged)
- 23 tools (unchanged)
- TIER 1 hit rate: 51.5% on 575 plays (unchanged)
- TIER 4 ≤ TIER 2 inversion: still holds
- Lib files: 32 → 31

## 1.6.3

### Refactor

Tool surface consolidation. Two of the findings from the June 11 audit, folded into one release. The algorithm, tier system, and CLI surface are unchanged — only the tool catalogue.

- **`screen_raw` removed** — was a thin wrapper around `client.queryScreenOdds` with no ranking, hydration, or formatter. Use `screen_ranked` with `verbosity="full"` instead, which already exposes the same raw payload plus ranking metadata, consensus, movement, and freshness.
- **Four bet-management tools consolidated into one** — `get_hidden_bets` + `hide_bet` + `unhide_bet` + `clear_hidden_bets` → `manage_hidden_bets({ action, bet?, id? })`. `action='list' | 'hide' | 'unhide' | 'clear'`. Same underlying client methods, just one tool name to learn. `action` is required; `bet` required for `hide`; `id` required for `unhide`.

### Stats

- 784 tests passing (-4 net: 3 screen_raw tests + 1 get_started test removed, all referenced decommissioned tools)
- 23 tools (was 27, -4)
- TIER 1 hit rate: 51.5% on 575 plays (unchanged from v1.6.2)
- TIER 4 ≤ TIER 2 inversion: still holds

## 1.6.4 — Bug fixes (addendum)

**Addendum note:** This release section captures a set of bug fixes, feature changes, and test updates that shipped in the codebase between v1.6.3 and v1.7.0 but were never migrated out of the `Unreleased` bucket in the changelog. The code changes themselves (commits `dbc7636` through `c117450`) are present in every release tag from v1.6.3 onward. This section exists so the versioned history matches the shipped code.

### Bug fix

- **`sharp_plays` now requires real sharp book confirmation for `Bet candidate` rows** — fixed the NoVigApp "consensus gap" where `consensusBookCount` was always 0 (NoVigApp is a P2P exchange, not a bookmaker, so its no-vig lines never matched any other book exactly). Each sharp book's screen is now cross-referenced individually to find independent supportive movement on the same game+selection. New row fields: `sharpBookMovementConfirmed`, `sharpBookMovementSource`, `sharpBookClv` — populated when a sharp book independently confirms the play. `movementIsSharpSourced` now accepts `sharpBookMovementConfirmed` as an alternative to traditional independent sharp movement. Misleading pass reasons (`no_usable_line_history`, `movement_source_is_target_book`, etc.) are suppressed when sharp book confirmation exists.
- **Removed unsound fallback paths in `classifySharpPlay`** — `consensusEdgeOnlyOk`, `consensusOnlyOk`, and `clvOnlyOk` were previously accepted as `Bet candidate` paths based on consensus edge or CLV alone without actual sharp movement confirmation. All `Bet candidates` now require either traditional `movementIsSharpSourced` (independent sharp book movement) or `sharpBookMovementConfirmed` (sharp book cross-reference). Also removed the `consensusValidated` path and the now-unused variables (`hasConsensusEdge`, `clvValue`, `movementLabelOk`, `movementUnverifiable`). Simplified pass reason logic — no longer conditional on fallback flags.

### Feature

- **Nitter RSS as primary tweet source in `player_context`** — `player_context` now tries Nitter RSS first (fast, no auth, local instance via `NITTER_BASE` env var, default `http://localhost:8080`). Fallback chain: Nitter RSS → X GraphQL (nitter-session-api) → Google News RSS → ESPN search. New source labels: `nitter-rss`, `nitter-combined`, `news-fallback` (previously only `x-direct`, `combined`, `empty`). New helper: `searchNitterRSS()` in `lib/propprofessor-news-sources.js` with RSS parsing that handles both Google News and Nitter RSS formats (`<dc:creator>` for author).
- **`skipHistory: boolean` param on screen tools** — added to `screen_ranked`, `recommended_bets`, `all_slates`, `staking_plan`, and `sharp_consensus`. When `true`, skips odds history hydration entirely — useful when you only need current odds/edges and don't need movement data. Propagated through all handler call chains: `recommended_bets` → `screen_ranked`, `staking_plan` → `recommended_bets`, `all_slates` → `runLeagueScreen`/`runTennisScreen`, `sharp_consensus` → `screen_ranked`. `sharp_plays` already supported it via `...args` spread in `runSharpPlays` service. Companion to `compact`: `compact` only affects output formatting, not data hydration — use `skipHistory` to skip hydration.

### Docs

- **Compact mode description fix** — clarified the `compact` param description across all tools: "Does NOT affect history hydration — movement data is always fetched." Previously the wording implied `compact` skipped history. Aligns the tool description with actual behavior (post-fix: `compact` is purely a payload-shaping flag, hydration always runs).

### Stats

- 784 tests passing (was 784 in v1.6.3; test count for this addendum window unchanged because the affected modules' tests were updated in-place rather than added/removed)
- 23 tools (unchanged)
- Tool count: 23 (unchanged)

## 1.6.2

### Bug fix

Response-layer cleanup. Three high-impact issues found in the June 11, 2026 code+response audit. The algorithm, tier system, and tool surface are unchanged — only how the data is shaped before it leaves the server.

- **CLI `--verbosity` is now wired through to the MCP handler** (`scripts/query-propprofessor.js`). Before: `--verbosity minimal` was silently dropped on the floor for the `sharp-plays` command, so the CLI always returned the raw 144KB payload regardless of the flag. After: `--verbosity minimal|standard|full` works end-to-end. The MCP server (line 861) was already wired correctly — this is CLI-only.
- **Response rows are now compacted at extraction** — null, empty-string, empty-array, and empty-object fields are stripped before the formatter runs. Applied to `sharp-plays`, `screen_ranked` (via `buildRankedScreenResponse`), and `find_best_price` (`allPrices`). The new `compactRow` helper lives in `lib/propprofessor-shared-utils.js`. Response payload drops ~96% for typical sharp-plays output (144KB → ~5KB for 3 plays). Empty fields were noise; the data users actually want is unchanged.
- **`selections.null` and `defaultKey: "null"` string leaks fixed at extraction** — PropProfessor's API uses the literal string `"null"` as a key to mean "no sub-market" (moneyline, spread, total). Before: that string leaked through to consumers as a real key. After: `normalizeRow` lifts `selections.null.*` to top level for non-prop markets and drops `defaultKey: "null"`. Player-prop selections (which use real player names as keys) are untouched.

### Stats

- 788 tests passing (was 775, +13)
- 27 tools (unchanged)
- TIER 1 hit rate: 51.5% on 575 plays (was ~50% on smaller sample — within noise)
- TIER 4 ≤ TIER 2 inversion: still holds (49.7% ≤ 49.9%)

## 1.6.1

### Docs

Pre-directory-submission polish. No code changes — the algorithm, tools, and tests are all unchanged from v1.6.0.

- **Repo description updated** — from "Standalone PropProfessor MCP server and query client" to "MCP server that surfaces sharp-money movement across 36 sportsbooks — signal feed, not betting oracle." This is what `mcp.so`, `awesome-mcp`, and other directory listings display as the first-glance summary.
- **Mermaid architecture diagram added** in the README — shows the data flow from 36 sportsbooks → PropProfessor API → ranking pipeline → 27 MCP tools → your AI agent. Renders natively in GitHub; makes the value prop visual in 5 seconds for directory visitors.
- **"How the ranking works" section trimmed** — the 5-step methodology (movement grading, risk score weights, tier table, hysteresis, sharp book cross-reference) moved to [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md). The README now has a 1-paragraph summary + link. Reduces README from 397 → 389 lines, makes the visible content more scannable.
- **FAQ section added** — answers the 5 questions directory visitors ask first: "Does this tell me what to bet?" (no, it surfaces signals), "Do I need an account?" (yes, paid PropProfessor), "What books does it cover?" (36), "Is it free?" (code is MIT, data is paid), "Can I run it without an MCP client?" (yes, `pp-query` CLI).

### Verified working (no fix shipped)

- `npm install` clean
- `pp-query health` returns valid auth token against live PropProfessor API
- Server boots cleanly (1.5s startup, no errors)
- `node scripts/backtest-synthetic.js` produces expected distribution (575 TIER 1 plays per 3000-scenario run, TIER 4 ≤ TIER 2 holds)

### Stats

- 775 tests passing (unchanged)
- 0 open issues
- 0 open PRs
- Tool count: 27 (unchanged)
- Algorithm: unchanged

## 1.6.0

### Pivot: sharp-money signal feed, not betting oracle

**The core finding from v1.5.5:** the synthetic backtest reliably shows the algorithm is finding coordinated sharp-money movement correctly (TIER 4 ≤ TIER 2 inversion holds, tier ordering is correct), but it does **not** reliably predict outcomes (TIER 1 hit rate is ~50% on a 580-play sample). The honest product positioning is a **sharp-money signal feed** — telling you _what sharp books are doing_ so you can decide what to bet, not telling you _what will happen_.

This release is a positioning + messaging change, not an algorithm change. The ranking pipeline, risk score, tier system, kaiCall semantics, and tool surface are unchanged. What changes is how the README and tool descriptions frame the system.

### Docs

- **README hero and intro reframed** — from "turns your AI agent into a sharp / tell you what to bet" to "shows you what the sharp money is doing / surface the sharp moves and let you decide". Added an explicit "Honest scope" callout that the system is a signal feed, not a betting oracle.
- **"The numbers" section reframed** — replaced "TIER 1 hit rate target: >60%" with measurement of _signal quality_ (tier ordering, steam move detection, line lag detection) rather than _predictive power_. The "what this means in practice" callout makes it explicit: trust the signal, not the outcome prediction.
- **"What you can ask your agent" prompts reframed** — replaced "Find me moneyline value on Lakers" with "What are tonight's strongest coordinated sharp moves across NBA and NHL?" and similar observation-focused prompts. The optional bet-tracking prompts are explicitly marked as optional.
- **"All 27 tools" section reframed** — user-type categories renamed from "casual/intermediate/sharp bettors" to "quick situational checks / deeper signal analysis / full raw data and research" (about _data depth_, not betting style). The "Betting" category is renamed to "Flagged Plays". `staking_plan` description now reads "for picks you decide to place" instead of just "Fractional Kelly sizing".
- **"See it in action" example reframed** — example prompt and lead text updated to emphasize signal quality, not action. The output JSON is unchanged because it's accurate — the framing around it is what changed.

### Tool definitions

- `recommended_bets` description updated — explicitly states the tier/kaiCall are quality ratings on the movement data, NOT predictions about outcomes. Use this as your "what is sharp money doing right now" tool.
- `get_started` description updated — clarifies that "casual/intermediate/sharp" labels are about data depth, not betting style.

### Stats

- 775 tests passing (unchanged)
- 0 open issues
- 0 open PRs
- Tool count: 27 (verified consistent across definitions, OpenAPI spec, and README by `check:claims`)
- Algorithm: unchanged. TIER 1 hit rate, risk-scoring weights, tier assignment table, and kaiCall semantics are identical to v1.5.5.

## 1.5.5

### Bug fix

- **Synthetic backtest was producing 99% TIER 4 plays** — the scenario generator had two compounding bugs that made the README's "TIER 1 hit rate" claim statistically meaningless:
  1. **Only 7 books** in the scenario — couldn't reach the `consensusBookCount >= 10` bonus needed for TIER 1 in the risk score. Expanded to 12 books (production has ~36; 12 is a representative subset).
  2. **Per-scenario tier cache and score timeline were not reset** between iterations in the backtest loop. The hysteresis layer in `lib/propprofessor-risk-score.js` is module-level global state — once a play got assigned TIER 4 early in the run, the cache and timeline kept it there for the rest of the backtest. Added `clearTierCache()` + `clearScoreTimeline()` calls at the start of each scenario.
- Added a new `strong_sharp_move` scenario type (15% of the mix) that produces the coordinated sharp-book movement the ranking pipeline needs to assign TIER 1. Updated the scenario mix to: 15% strong_sharp_move / 25% sharp_move / 30% stable_no_edge / 30% adverse. Without this scenario type, the ranking pipeline never had a realistic chance to assign TIER 1.

### Docs

- **README "The numbers" section corrected** — the v1.5.3-era claim of "55.9% TIER 1 hit rate" and "+6.9 to +7.2pp TIER 1 vs TIER 3 gap" was based on a 3-5 play sample (noise). The new backtest produces a stable distribution across seeds:
  - TIER 1 hit rate: **48.9% to 52.4%** (avg ~50.7%) on ~580 plays per 3000 scenarios
  - TIER 1 vs TIER 3 gap: **+0.3 to +3.1pp** (avg ~1.2pp)
  - TIER 4 ≤ TIER 2 inversion: **holds in 4 of 6 seeds** (the v1.5.1 fix is directionally correct, but the synthetic backtest is still noisy)

  The honest read: the ranking algorithm is finding some edge (TIER 1 > TIER 3) but it's small. The v1.6.0 milestone ("TIER 1 hit rate from 55.9% to >60%") has a longer road than the v1.5.3-era changelog suggested — the real baseline is ~50%, and reaching 60% requires meaningful algorithm work, not just backtest noise reduction.

### Chore

- **`check:claims` now requires at least 100 TIER 1 plays per 3000-scenario backtest** before it considers the TIER 1 sample size meaningful. Below that threshold, the hit rate is just noise and any "X% TIER 1 hit rate" claim is unsupportable. The v1.5.3-era backtest produced 3-5 TIER 1 plays per run; the new backtest produces ~580.
- Added a test that verifies all 4 tiers produce plays (guards against the "99% TIER 4" failure mode recurring) and that the TIER 1 sample size meets the 100-play minimum.

### Stats

- 775 tests passing (was 774 — added `runBacktest produces enough TIER 1 plays for a meaningful hit rate` test)
- 0 open issues
- 0 open PRs
- Tool count: 27 (verified consistent across definitions, OpenAPI spec, and README by `check:claims`)

## 1.5.4

### Docs

- **README test count corrected** — bumped from 773 to 774 to match the v1.5.3 changelog (which already noted the +1 from `test/backtest-daily-snapshot.test.js`). Updated the badge, "The numbers" table, Status section, and maintainers section. The shipped v1.5.3 README was internally inconsistent — the changelog and the codebase agreed on 774, the README didn't.

### Chore

- **Added `npm run check:claims`** — automates the pre-release claim-drift checks that the `propprofessor-mcp-release-format` skill documents. Verifies that the README's tool count matches the tool definitions and the OpenAPI spec, that every tool referenced in the "All N tools" section actually exists, that the test count matches `npm test` output, and that the TIER 4 ≤ TIER 2 inversion claim is directionally supported. Runs in 1.1s with `--skip-tests`, 5.2s full. This is the script that would have caught the test-count drift above on the v1.5.3 release — flagging the issue at the source instead of leaking into a shipped README.
- **Deleted 3 stale branches** — `fix/novig-screen-research-and-filtering` (already merged), `release/v1.3.0-market-freshness-overhaul` and `release/v1.4.0-dx-and-cleanup` (long-since shipped release branches). Cleanup only, no code impact.

### Stats

- 774 tests passing (unchanged)
- Open issues: 0
- Open PRs: 0
- Tool count: 27 (verified consistent across definitions, OpenAPI spec, and README by `check:claims`)

## 1.5.3

### Bug fix

- **Cron data pollution** — `scripts/backtest-daily-snapshot.js` now validates the league parameter against a supported-league list (`NBA`, `MLB`, `NHL`, `NFL`, `WNBA`, `UFC`, `TENNIS`, `SOCCER`, `NCAAB`, `NCAAF`) before writing snapshot files. Previously, any league the upstream API returned — including garbage values like `NONEXISTENT_LEAGUE_999` — was being persisted to `backtest-data/`. The script also no longer auto-runs its `main()` on `require()` (now guarded by `require.main === module`), so importing it from tests no longer kicks off the cron job.
- **Tool count drift** — `clear_score_timeline` is now registered in the OpenAPI spec generator (`scripts/generate-openapi-spec.js`), bringing the tool count to **27** across README, code, and OpenAPI. Previously the tool was implemented in the server and pinned in the integration tests, but missing from the auto-generated API spec.

### Chore

- **Removed dangling `audit:sharp-research` npm script** — `package.json` referenced `scripts/audit-sharp-play-research.js` which never existed. Zero callers in the codebase, docs, or CI. The dead reference is gone.

### Housekeeping

- **Closed 9 stale v1.3.0 issues** (#20–#28) — all were already shipped in v1.3.0–v1.4.0. Closed retroactively with references to the shipping commits so the issues tab no longer shows a misleading "9 open enhancement issues all targeting v1.3.0."

### Stats

- 774 tests passing (was 773 — added `test/backtest-daily-snapshot.test.js`)
- README tool count: 26 → 27
- OpenAPI spec endpoints: 26 → 27
- Zero algorithm changes. TIER 1 hit rate, risk-scoring weights, tier assignment table, and kaiCall semantics are unchanged from v1.5.2.
- TIER 1 hit rate work (the 55.9% → 60% gap) is deferred to v1.6.0.

## 1.5.2

### New README

The README has been rewritten from scratch to be useful to a sports bettor who landed in a GitHub directory listing — not just a developer wiring up an MCP.

**What changed:**

- Hero section with a real example output from `recommended_bets` so visitors can see what the tool returns in 5 seconds, before installing
- "The numbers" section leads with backtest results (TIER 1 hit rate, TIER 1 vs TIER 3 gap, TIER 4 inversion fix) — the proof, not promises
- "What you can ask your agent" section groups example prompts by bettor scenario (pre-game, line shopping, validation, sizing, player context) — use cases before the tool list
- "How the ranking works" is now a full methodology section explaining the green/yellow/red movement grade, the 1–10 risk score formula, the tier assignment table, the hysteresis layer, and the kaiCall semantics. Math-first, no hand-waving. This is the moat.
- "Backtesting" section explains both the synthetic backtest and the daily-snapshot cron, with thresholds for what healthy tier ordering looks like
- "Support this project" is a small tip-jar section — community-funded, no upsell
- Demo workflow uses a realistic Lakers @ Celtics example instead of placeholder text

**What was moved out of the README to `docs/`:**

- Performance flags (`compact`, `skipHistory`, `fields`, `include`, `verbosity`, cache, `caveman-shrink`) → `docs/PERFORMANCE.md`
- Environment variables and book configuration → `CONFIG.md` (expanded; was a thin table, now full reference)

**What was cut:**

- "Verified Runtime Behavior (2026-06-06)" — stale by definition. The live CI badge replaces it.
- "For Maintainers" hardcoded test count (now generated from `npm test`)

### Stats

- 773 tests passing
- 82% statement coverage
- README is now 357 lines (was 367) but with substantially more useful content and 100% of the methodology

## 1.5.1

### Fix: TIER 4 > TIER 2 inversion

The `gradeMovementQuality` function was marking `insufficient_history` plays as RED, which buried ~50% of plays as TIER 4 even when they were coin-flip plays with no negative signal. This caused TIER 4 hit rate to exceed TIER 2.

**Root cause:** `noMovementData = movementLabel === 'insufficient_history' && edge < 0.5` was a RED condition. Missing history data is not an adverse signal — it's just absence of data.

**Fix:** Removed `noMovementData` from RED conditions. Now only genuinely adverse signals (`movementLabel === 'adverse'`) or bad execution with thin consensus trigger RED.

**Backtest results (3000 scenarios, before → after):**

- TIER 4 vs TIER 2: was inverted (50.6% > 47.8%) → now correct (48.6% < 53.2%)
- TIER 1 vs TIER 3 gap: 6.9pp → 7.2pp (improved)
- Tier ordering: TIER 1/2 > TIER 3 > TIER 4 (clean)

### Improved synthetic backtest generator

Scenario generator now creates three distinct scenario types with real edge conditions:

- `sharp_move` (35%): Sharp books moved, target book is stale → should be TIER 1/2
- `stable_no_edge` (35%): All books agree, no edge → should be TIER 3/4
- `adverse` (30%): Sharp books moving against the pick → should be TIER 4

## 1.5.0

### Token refresh mutex

Concurrent requests that trigger 401s now share a single token refresh instead of each independently calling `fetchAccessToken`. The `tokenRefreshPromise` singleton in `createPropProfessorClient` ensures only one refresh happens at a time — subsequent callers wait for the same promise.

- 3 new tests: concurrent refresh dedup, refresh-after-expiry, concurrent invalidation wait
- Reduces unnecessary API calls to PropProfessor's token endpoint under load

### Synthetic backtest validation

`scripts/backtest-synthetic.js` — runs the full ranking pipeline (extract → hydrate → rank → tier) against synthetic scenarios with known outcomes. Reports per-tier hit rates and validates tier differentiation.

**Results (500 scenarios):**

- TIER 1: 55.9% hit rate (borderline — target is >60%)
- TIER 1 vs TIER 3 gap: +6.9pp — system differentiates quality
- TIER 4 > TIER 2: red flag — risk flags need tuning

**Files:**

- `scripts/backtest-synthetic.js` — scenario generator + backtest runner + reporting
- `test/backtest-synthetic.test.js` — 6 tests for scenario generation and backtest execution

### Test count

717 tests total, 717 passing.

## 1.4.2

### Fixture-based handler integration tests

Offline tests for all major MCP handlers — no auth, no network, no API dependency.

**New files:**

- `test/fixtures/screen-payloads.js` — 3 NBA games + 1 MLB game across 5 books with deliberate odds differences (consensus, sharp movement, split market)
- `test/fixtures/odds-history.js` — odds history with steam moves, gradual drift, and stable lines
- `test/fixtures/mock-client.js` — shared mock client factory with call tracking and customizable payloads
- `test/handler-integration.test.js` — 26 tests across 11 suites

**Handlers tested:**

- `screen_ranked` (7 tests) — ranking, limit, compact, fields, Spread, Total
- `screen` (2 tests) — NBA, MLB league-specific
- `sharp_plays` (3 tests) — resultMeta, Fliff lag detection, multi-league
- `recommended_bets` (3 tests) — tier/kai structure, targetTiers filter, marketsBreakdown
- `staking_plan` (1 test) — stake allocation structure
- `find_best_price` (1 test) — line shopping across books, price sorting
- `all_slates` (2 tests) — consolidated results, multi-league
- `health_status` (1 test) — auth session info
- `league_presets` (1 test) — no client calls
- `ev_candidates` (2 tests) — validation, result structure
- `error handling` (3 tests) — empty game_data, missing selections, empty leagues

**Test count:** 708 total (707 pass, 1 pre-existing live smoke failure).

## 1.4.1

### Auth session expiry detection

Session cookie (`__Secure-next-auth.session-token`) TTL is now parsed from `auth.json` and surfaced everywhere:

- **`health_status` MCP tool** — returns `auth.session` with `status`, `expiresAt`, `daysRemaining`, and `warning`
- **`pp-query doctor`** — `summary` now includes `session`, `sessionExpiresAt`, `sessionDaysRemaining`, `sessionWarning`; next-step guidance changes based on expiry status
- **`inspectAuthSetup()`** — new `sessionExpiry` field with full cookie analysis
- **`getCookieExpiryInfo()`** — new exported function, reusable across CLI and MCP

Status levels: `ok` (>7d), `warning` (3–7d), `critical` (≤3d), `expired` (≤0d).

### Auth watchdog cron script

`scripts/pp-auth-watchdog.js` — standalone script for Hermes cron (`no_agent: true`). Silent when healthy, outputs a warning when session is expiring or expired. No tokens consumed.

### Tests

8 new tests for `getCookieExpiryInfo` covering ok/warning/critical/expired/no_auth/no_session_token/browser_session_only/allCookieExpiries. Total: 682 passing.

## 1.4.0

### Removed TIER 4 fallback from recommended_bets

When no TIER 1/2 plays exist, `recommended_bets` now returns 0 plays instead of falling back to `sharp_plays` with `strict=false` and `includePasses=true`. The previous fallback surfaced TIER 4 plays, contradicting the "never bet TIER 4" philosophy.

### Fixed tool descriptions

- `sharp_plays` `markets` param description now correctly states default is `["Moneyline", "Spread", "Total"]` (was "default Moneyline")
- `novig_screen` `markets` param description updated similarly
- Both tools already scanned all three markets — only the descriptions were wrong

### Navigable server architecture

`propprofessor-mcp-server.js` handlers grouped into domain sections:

- Screening & Ranking (7 handlers)
- Sharp Movement (2 handlers)
- Betting (2 handlers)
- Player Context, UFC, Bet Management, Line Shopping, Meta, Picks, Alerts

Full file split into separate modules deferred to v1.5 — cross-handler dependencies need integration tests first.

### DX improvements

- Added "What's New in v1.4.0" section to README
- Added expanded troubleshooting section to SETUP.md covering common issues (auth expiry, 0 tools, no bets found, timeouts)

## 1.3.0

### Market Name Normalization (Phase 3)

**Generic aliases now resolve per-league** — query `market="Total"` for any league and get the correct upstream market name:

| Alias  | NHL         | MLB        | NBA          | WNBA/SOCCER                |
| ------ | ----------- | ---------- | ------------ | -------------------------- |
| Total  | Total Goals | Total Runs | Total Points | Total Points / Total Goals |
| Spread | Puck Line   | Run Line   | Spread       | Spread                     |

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
- Phase 8 (Tests) complete — 674 tests

### marketsBreakdown in recommended_bets

**New `marketsBreakdown` field** in `recommended_bets` response showing play count by market type:

```json
"marketsBreakdown": { "Moneyline": 3, "Spread": 1, "Total": 0 }
```

Makes it transparent when Spread/Total have fewer plays due to upstream data quality, rather than appearing as a moneyline-only tool.

## Cross-Book Consensus Expansion (Phase 4)

**Alt markets now get expanded comparison book sets.** Previously, querying Run Line for MLB only compared against the same sharp book set as Moneyline — but Circa, BookMaker, etc. don't consistently post Run Line odds. Now:

| League | Alt Market | Books                                                              |
| ------ | ---------- | ------------------------------------------------------------------ |
| MLB    | Run Line   | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |
| MLB    | Total Runs | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel            |
| NHL    | Puck Line  | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |
| NBA    | Spread     | Pinnacle, Circa, BetOnline, DraftKings, BetMGM, FanDuel, BookMaker |

**New `consensusStrength` field** on every ranked row:

| Value      | Meaning               |
| ---------- | --------------------- |
| `strong`   | 3+ books agree        |
| `moderate` | 2 books agree         |
| `weak`     | 1 book (no consensus) |
| `none`     | 0 books               |

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
