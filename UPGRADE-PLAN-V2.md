# PropProfessor MCP — Master Upgrade Plan

**Repo:** `j17drake/propprofessor-mcp` (local: `/Users/jamesdrake/Documents/workspace/propprofessor-mcp`)
**Current version:** 1.2.0
**Target version:** 1.3.0 (minor bump per user direction; breaking changes documented in CHANGELOG)
**Branch:** `fix/novig-screen-research-and-filtering` (active)
**Test count:** 583 passing
**Tests target:** 700+
**Node version:** 18+ (CI now runs Node 20/22)

---

## Executive Summary

This is a **minor version upgrade (1.2.0 → 1.3.0)** that addresses every issue from the 2026-06-09 debug session, plus a full market-diversity overhaul, scoring engine hardening, and infrastructure improvements. The release fixes the `freshnessFallbackUsed` bug, makes all main-line markets (Run Line, Puck Line, Total Goals, Total Points) first-class citizens, normalizes market-name aliases, and adds the Phase 6-9 work that was deferred from the 1.1.0 market-diversity rollout.

**Why 1.3 not 2.0:** Per user direction, we bump minor (1.3.0). Breaking changes — specifically the field contract change (NULL → populated) and `markets_queried` moving to top-level response — are documented in CHANGELOG as breaking under a 1.3 release. This avoids forcing downstream consumers to re-pin major version while still surfacing the contract change clearly.

**Why now:** Live debug on 2026-06-09 showed the MCP returning `freshnessFallbackUsed: true` on every call, breaking all edge/tier/kai calculations. The user explicitly requested a full version upgrade.

---

## Goals (Measurable)

| # | Goal | Measurement |
|---|------|-------------|
| G1 | `freshnessFallbackUsed: false` on healthy responses | Health check returns no fallback flag |
| G2 | Edge/tier/kai populated on `/screen` endpoint | Sample query returns non-null values |
| G3 | All main-line markets queryable via aliases | "Total" resolves to correct per-league name |
| G4 | Token expiry > 30 min | Health check shows expiresInSeconds > 1800 |
| G5 | Cross-book consensus on Run Line / Total > 1 | consensusBookCount > 1 for non-ML markets |
| G6 | 700+ tests passing | `npm test` exit 0 |
| G7 | Zero lint errors | `npm run lint` exit 0 |
| G8 | All 26 tools return `markets_queried` in resultMeta | Audit script validates |
| G9 | All 26 tools handle errors with codes + recovery | All error paths return ErrorCode schema |
| G10 | Live smoke test green for 7 consecutive days | `smoke:live` script |

---

## Phase Architecture

Each phase is designed to run in **parallel where possible** (multiple subagents on independent files) or **sequentially** (when dependent on prior phase output). Subagent prompts at the bottom of this document.

```
Phase 0: Triage + Branch Setup           [BLOCKING — must complete first]
   ↓
Phase 1: Freshness Engine Fix           [P0 — fixes the core bug]
   ↓
Phase 2: Scoring Pipeline Restoration   [P0 — depends on Phase 1]
   ↓
Phase 3: Market Name Normalization      [P0 — independent, can run with Phase 1+2]
   ↓
Phase 4: Cross-Book Consensus Expansion [P1 — depends on Phase 1]
   ↓
Phase 5: Token Persistence Layer        [P1 — independent]
   ↓
Phase 6: Tool Description Overhaul      [P2 — depends on Phase 3]
   ↓
Phase 7: Verbosity + Response Contract  [P2 — depends on Phase 2]
   ↓
Phase 8: Test Suite Expansion           [P1 — runs in parallel with 3-7]
   ↓
Phase 9: Documentation + Changelog       [P2 — depends on all code phases]
   ↓
Phase 10: Release + Verification         [FINAL — must complete last]
```

---

## PHASE 0: Triage + Branch Setup

**Effort:** 30 min | **Owner:** Lead agent (you)
**Subagents:** 0 | **Parallelism:** N/A

### Tasks

1. **Confirm current branch state:**
   ```bash
   cd /Users/jamesdrake/Documents/workspace/propprofessor-mcp
   git status --short
   git log --oneline -5
   ```
   Expected: On `fix/novig-screen-research-and-filtering` with 6 modified files in working tree.

2. **Stash current work-in-progress to isolate:**
   ```bash
   git stash push -m "v2.0.0-prep: WIP from novig screen branch"
   ```

3. **Create dedicated v1.3.0 branch from main:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b release/v1.3.0-market-freshness-overhaul
   git push -u origin release/v1.3.0-market-freshness-overhaul
   ```

4. **Pop WIP onto release branch (if needed for reference):**
   ```bash
   git stash pop
   git diff --stat
   ```
   Review the 6 modified files. Decide: cherry-pick the relevant commits from `fix/novig-screen-research-and-filtering` or leave WIP for after release.

5. **Document baseline in CHANGELOG.md "Unreleased" section:**
   ```markdown
   ## [Unreleased — 1.3.0]
   ### In Progress
   - Freshness engine overhaul (P0 bug from 2026-06-09)
   - Market name normalization (P0 from PLAN-MARKET-DIVERSITY)
   - Scoring pipeline restoration
   - Token persistence layer
   - 700+ tests target
   ```

6. **Open 9 GitHub issues** (one per phase) to track work:
   - Title format: `[v1.3.0] Phase N: <phase name>`
   - Labels: `v1.3.0`, `enhancement`, `phase-N`
   - Body: link to this plan, list the tasks

### Acceptance Criteria

- [ ] On `release/v2.0.0-market-freshness-overhaul` branch
- [ ] 9 GitHub issues opened
- [ ] CHANGELOG.md has "[Unreleased]" section
- [ ] Baseline 583 tests passing on this branch

---

## PHASE 1: Freshness Engine Fix (P0)

**Effort:** 4-6 hours | **Risk:** High | **Subagents:** 2 (parallel)
**Files touched:** 3-4

### Root cause

The PropProfessor backend is not receiving real timestamp data from its upstream odds feed. The `freshness` object in every response shows `freshnessFallbackUsed: true`, `newestAgeMs: 0`, `oldestAgeMs: 0`. This cascades — the scoring engine in `propprofessor-analysis.js` short-circuits on missing timestamps and never populates `edge`/`tier`/`kai` fields.

### Investigation tasks (Subagent 1)

1. **Trace the freshness data flow:**
   - Read `lib/propprofessor-api.js` — find the response parsing path
   - Read `lib/propprofessor-screen-utils.js` — find the freshness computation
   - Read `lib/propprofessor-mcp-ranked-screen.js` — find where freshness gates downstream calculations
   - Document the chain in a comment block at the top of `lib/propprofessor-analysis.js`

2. **Identify the upstream data source:**
   - The backend likely uses OddsJam or similar aggregator
   - Find HTTP client config in `lib/propprofessor-api.js`
   - Check `got-scraping` settings — timeout, headers, retries
   - Look for any response transformation that might be stripping timestamps

3. **Check git history for the bug introduction:**
   ```bash
   git log --oneline -- lib/propprofessor-analysis.js
   git log --oneline -- lib/propprofessor-api.js
   ```
   Find the commit that introduced the `freshnessFallbackUsed` flag or the scoring short-circuit.

4. **Output:** A diagnostic report at `/Users/jamesdrake/.hermes/propprofessor-freshness-diag.md` with:
   - Exact file:line where timestamps are lost
   - Whether the upstream feed provides timestamps (test with curl)
   - Proposed fix location (which file, which function)

### Fix tasks (Subagent 2 — after Subagent 1 reports)

1. **Apply the fix in the identified location.** Likely candidates:
   - `lib/propprofessor-api.js` — add timestamp preservation in response transform
   - `lib/propprofessor-screen-utils.js` — fallback to current time instead of returning zeros
   - `lib/propprofessor-analysis.js` — don't gate on freshness, just warn

2. **Add a `parseTimestamp` utility** if not present:
   ```js
   // lib/propprofessor-shared-utils.js (new function)
   function parseTimestamp(ts) {
     if (!ts) return null;
     const parsed = new Date(ts);
     return isNaN(parsed.getTime()) ? null : parsed;
   }
   ```

3. **Modify the freshness computation** to not use zero as default:
   ```js
   // lib/propprofessor-screen-utils.js
   // Before:
   newestAgeMs: 0, oldestAgeMs: 0
   
   // After:
   const now = Date.now();
   const newestAgeMs = newestTs ? now - newestTs.getTime() : null;
   const oldestAgeMs = oldestTs ? now - oldestTs.getTime() : null;
   ```

4. **Add a test for the fix:**
   ```js
   // test/freshness-fix.test.js (new)
   test('freshness returns real ages when upstream provides timestamps', () => {
     const result = parseScreenResponse(mockResponseWithTimestamps);
     assert(result.freshness.freshnessFallbackUsed === false);
     assert(result.freshness.newestAgeMs > 0);
   });
   ```

### Acceptance Criteria

- [ ] Health check returns `freshnessFallbackUsed: false` on a normal query
- [ ] `newestAgeMs` and `oldestAgeMs` are non-zero values
- [ ] New test in `test/freshness-fix.test.js` passes
- [ ] Diagnostic report committed at `~/.hermes/propprofessor-freshness-diag.md`

---

## PHASE 2: Scoring Pipeline Restoration (P0)

**Effort:** 3-4 hours | **Risk:** Medium | **Subagents:** 1
**Files touched:** 2-3

### Root cause

`edge`/`tier`/`kai` fields return null on `/screen` endpoint because the scoring engine in `propprofessor-analysis.js` short-circuits on `freshnessFallbackUsed: true`. The `novig_screen` endpoint has its own independent pipeline that doesn't have this gate.

### Tasks

1. **Audit the scoring engine** — Read `lib/propprofessor-analysis.js`:
   - Find the gate condition that disables scoring on fallback mode
   - Document which calculations depend on freshness data
   - Identify which calculations (if any) can run without freshness

2. **Decouple scoring from freshness:**
   - Edge calculation: does NOT need freshness — uses current odds vs sharp book
   - Tier assignment: uses edge + risk — independent of freshness
   - Kai call: uses tier + context — independent of freshness
   - Movement grade: NEEDS freshness/history — must remain gated

3. **Apply the decoupling fix** in `lib/propprofessor-analysis.js`:
   ```js
   // Before: gate entire scoring on freshness
   if (row.freshnessFallbackUsed) {
     return { ...row, edge: null, tier: null, kai: null };
   }
   
   // After: gate only movement-dependent fields
   return {
     ...row,
     edge: computeEdge(row),           // always compute
     tier: assignTier(row),            // always compute
     kai: assignKaiCall(row),          // always compute
     movementGrade: row.freshnessFallbackUsed 
       ? 'unknown' 
       : computeMovementGrade(row)     // gate only this
   };
   ```

4. **Update test expectations:**
   - `test/propprofessor-analysis.test.js` — update assertions for fallback mode behavior
   - Add test: "scoring runs even when freshness is fallback"

5. **Cross-validate:** Compare scoring output between `/screen` and `/novig_screen` for the same game/market. They should produce identical edge/tier/kai values.

### Acceptance Criteria

- [ ] `edge`, `tier`, `kai` populated on `/screen` responses
- [ ] `movementGrade` correctly gated (returns `"unknown"` in fallback mode)
- [ ] `/screen` and `/novig_screen` produce identical scoring for same inputs
- [ ] Existing 583 tests still pass (or are updated appropriately)

---

## PHASE 3: Market Name Normalization (P0)

**Effort:** 2-3 hours | **Risk:** Low | **Subagents:** 1
**Files touched:** 2-3

### Root cause

Each league uses sport-specific market names. The MCP doesn't normalize aliases. Querying `market="Total"` for NHL returns zero rows silently.

### Tasks

1. **Build the alias map** — add to `lib/propprofessor-shared-utils.js`:
   ```js
   const MARKET_ALIASES = {
     total: { 
       NHL: 'Total Goals', 
       MLB: 'Total Runs', 
       NBA: 'Total Points',
       WNBA: 'Total Points',
       NCAAB: 'Total Points',
       NCAAF: 'Total Points',
       NFL: 'Total Points',
       TENNIS: 'Total Games',
       UFC: 'Total Rounds',
       SOCCER: 'Total Goals',
     },
     spread: {
       NHL: 'Puck Line',
       MLB: 'Run Line',
       NBA: 'Spread',
       WNBA: 'Spread',
       NCAAB: 'Spread',
       NCAAF: 'Spread',
       NFL: 'Spread',
       SOCCER: 'Spread',
     },
     puck_line: { NHL: 'Puck Line' },
     run_line: { MLB: 'Run Line' },
     total_goals: { NHL: 'Total Goals' },
     total_runs: { MLB: 'Total Runs' },
     total_points: { NBA: 'Total Points', WNBA: 'Total Points', NCAAB: 'Total Points', NCAAF: 'Total Points', NFL: 'Total Points' },
   };
   ```

2. **Create a `resolveMarketName` function:**
   ```js
   function resolveMarketName(input, league) {
     if (!input) return 'Moneyline';  // default
     const normalized = String(input).toLowerCase().trim().replace(/\s+/g, '_');
     const alias = MARKET_ALIASES[normalized];
     if (alias) {
       return alias[league] || alias[Object.keys(alias)[0]] || input;
     }
     return input;  // pass through unchanged
   }
   ```

3. **Apply the resolver at all entry points** in `scripts/propprofessor-mcp-server.js`:
   - `screen` handler — line ~658
   - `screen_ranked` handler — line ~680
   - `recommended_bets` handler — line ~904
   - `staking_plan` handler — line ~1036
   - `all_slates` handler — line ~1102
   - `sharp_plays` handler — line ~719
   - `novig_screen` handler — line ~775
   - `ev_candidates` handler — line ~1160
   - `find_best_price` handler — line ~1266
   - `get_play_details` handler — line ~1378

4. **Add a warning when an alias is used:**
   ```js
   // In resolveMarketName, return both the resolved name and a "wasAliased" flag
   // Tools include this in resultMeta as markets_alias_used: ['total → Total Goals']
   ```

5. **Tests:**
   - `test/market-aliases.test.js` — new file
   - Test: `resolveMarketName('Total', 'NHL')` returns `'Total Goals'`
   - Test: `resolveMarketName('spread', 'MLB')` returns `'Run Line'`
   - Test: `resolveMarketName('Moneyline', 'NBA')` returns `'Moneyline'` (no alias)

6. **Update CLI** (`scripts/query-propprofessor.js`):
   - Add `--market-aliases` flag that prints the alias map
   - Document the aliases in CLI help text

### Acceptance Criteria

- [ ] `screen(league="NHL", market="Total")` returns NHL goals data
- [ ] `screen(league="MLB", market="Spread")` returns Run Line data
- [ ] All 26 tools apply the resolver
- [ ] New test file with 10+ cases passes
- [ ] `markets_alias_used` field in resultMeta when aliases resolved

---

## PHASE 4: Cross-Book Consensus Expansion (P1)

**Effort:** 4-5 hours | **Risk:** Medium | **Subagents:** 2 (parallel)
**Files touched:** 2-3

### Root cause

Sharp books (Circa, BetOnline, DraftKings, BetMGM) don't post Run Line or Total Runs odds as consistently as Moneyline. `consensusBookCount: 1` for alt markets means no cross-book validation.

### Investigation tasks (Subagent 1)

1. **Map which books post which markets** per league:
   ```bash
   # Use the live API to query each book for each market
   for book in Pinnacle Circa BookMaker BetOnline DraftKings BetMGM; do
     for market in Moneyline Run_Line Total_Runs; do
       curl -s "https://api.propprofessor.com/screen?league=MLB&market=$market&book=$book" | jq '.result | length'
     done
   done
   ```

2. **Build a per-league per-market book availability matrix:**
   | League | Market | Books Posting |
   |--------|--------|---------------|
   | MLB | Moneyline | 5+ |
   | MLB | Run Line | 1-2 |
   | MLB | Total Runs | 1-2 |
   | ... | ... | ... |

3. **Output:** A `docs/MARKET-BOOK-AVAILABILITY.md` table.

### Fix tasks (Subagent 2)

1. **Expand the comparison book set** for alt markets in `lib/propprofessor-sharp-books.js`:
   ```js
   // Add sport-specific book preferences for alt markets
   const ALT_MARKET_BOOKS = {
     MLB: {
       'Run Line': ['Pinnacle', 'Circa', 'BetOnline', 'DraftKings', 'BetMGM'],
       'Total Runs': ['Pinnacle', 'Circa', 'BetOnline', 'DraftKings'],
     },
     NHL: {
       'Puck Line': ['Pinnacle', 'BetOnline', 'Circa', 'Kalshi'],
       'Total Goals': ['Pinnacle', 'BetOnline', 'Circa', 'Kalshi'],
     },
     // ... etc
   };
   ```

2. **Update the consensus calculation** to gracefully handle sparse book coverage:
   ```js
   // In lib/propprofessor-screen-utils.js
   // If only 1-2 books post, use weighted consensus (more weight to higher-liquidity book)
   function computeWeightedConsensus(odds, bookLiquidity) {
     // ...weighted average implementation
   }
   ```

3. **Add a `consensusStrength` field:**
   - `"strong"` — 3+ books agree
   - `"moderate"` — 2 books agree
   - `"weak"` — 1 book (no consensus)
   - `"single_book"` — only one book posted

4. **Tests:**
   - Test: `computeWeightedConsensus` returns reasonable values
   - Test: 2-book consensus is `moderate`, 1-book is `weak`

### Acceptance Criteria

- [ ] At least 2 books post Run Line / Total Runs for MLB
- [ ] `consensusStrength` field populated on all rows
- [ ] `docs/MARKET-BOOK-AVAILABILITY.md` committed
- [ ] Tests pass for weighted consensus calculation

---

## PHASE 5: Token Persistence Layer (P1)

**Effort:** 2-3 hours | **Risk:** Low | **Subagents:** 1
**Files touched:** 1-2

### Root cause

Token expires in 196 seconds (3 min). The MCP creates a new auth session on every startup.

### Tasks

1. **Read `lib/propprofessor-api.js`** to find the auth flow:
   - Find where the token is fetched
   - Find where it's stored (if at all)
   - Find where it's expired/refreshed

2. **Implement token persistence:**
   - Store token in `~/.propprofessor/auth.json` with `expiresAt` timestamp
   - On startup, read token and check if still valid
   - If valid, reuse. If expired, fetch new one.
   - If less than 5 min until expiry, refresh proactively

3. **Add a token manager** to `lib/propprofessor-shared-utils.js`:
   ```js
   class TokenManager {
     constructor(authFile) { ... }
     async getToken() { ... }   // returns valid token, refreshing if needed
     async refresh() { ... }
     getExpiresIn() { ... }     // returns seconds until expiry
   }
   ```

4. **Wire the TokenManager into the API client** in `lib/propprofessor-api.js`:
   - Replace inline auth with TokenManager
   - Add retry logic: if 401 returned, refresh token and retry once

5. **Update `health_status`** to report token state clearly:
   ```js
   return {
     ok: true,
     token: {
       expiresInSeconds: tm.getExpiresIn(),
       expiresAt: tm.getExpiresAt(),
      lastRefreshed: tm.getLastRefreshed(),
       refreshCount: tm.getRefreshCount(),
     },
   };
   ```

6. **Tests:**
   - Test: TokenManager persists token across "restarts" (mocked)
   - Test: TokenManager refreshes when within 5 min of expiry
   - Test: TokenManager handles refresh failure gracefully

### Acceptance Criteria

- [ ] Health check shows `expiresInSeconds > 1800` (30 min)
- [ ] Token persists across MCP restarts
- [ ] Auto-refresh within 5 min of expiry
- [ ] New tests in `test/token-manager.test.js` pass

---

## PHASE 6: Tool Description Overhaul (P2)

**Effort:** 2 hours | **Risk:** Zero (docs only) | **Subagents:** 1
**Files touched:** 2

### Tasks

1. **Read `lib/propprofessor-tool-definitions.js`** to find all 26 tool descriptions.

2. **For each tool, update the description to include:**
   - Default market list (after Phase 3 normalization)
   - The `markets` array param with example
   - League-specific market name examples
   - The `markets_queried` response field
   - Any new fields from Phase 1, 2, 4, 5

3. **Standardize description structure:**
   ```
   <one-line summary>
   
   <key behaviors>
   - Defaults to: <list>
   - Override: pass `<param>: <value>`
   - Returns: <field list>
   
   <example call>
   ```

4. **Specifically update these tools:**
   - `screen` — document market aliases
   - `screen_ranked` — document `markets` param
   - `recommended_bets` — document multi-market default
   - `staking_plan` — document multi-market inheritance
   - `sharp_plays` — document multi-market default
   - `all_slates` — document `markets` param
   - `novig_screen` — document sport-specific market names
   - `ev_candidates` — document `marketTypes` param
   - `ufc_card` — document `markets` param
   - `find_best_price` — document market name conventions
   - `get_play_details` — document sport-specific market names
   - `player_context` — no change
   - `league_presets` — no change
   - `get_alerts` — no change
   - `sharp_consensus` — no change
   - `log_pick` — no change
   - `get_pick_history` — no change
   - `get_pick_stats` — no change
   - `resolve_pick` — no change
   - `hide_bet` / `unhide_bet` / `clear_hidden_bets` / `get_hidden_bets` — no change
   - `get_started` — no change
   - `health_status` — document new token fields

5. **Regenerate OpenAPI spec:**
   ```bash
   npm run docs:openapi
   ```

6. **Verify:** Run `scripts/generate-openapi-spec.js` and check that the new descriptions appear in `docs/openapi.json`.

### Acceptance Criteria

- [ ] All 26 tool descriptions follow the new structure
- [ ] `docs/openapi.json` regenerated and includes new descriptions
- [ ] No broken references in descriptions

---

## PHASE 7: Verbosity + Response Contract (P2)

**Effort:** 3 hours | **Risk:** Low | **Subagents:** 1
**Files touched:** 2-3

### Tasks

1. **Audit current verbosity implementation** in `lib/propprofessor-formatter.js`:
   - Find `minimal` / `standard` / `full` branches
   - Check which fields each verbosity level returns
   - Document gaps

2. **Add the new fields to appropriate verbosity levels:**
   | Field | minimal | standard | full |
   |-------|---------|----------|------|
   | `edge` | ✓ | ✓ | ✓ |
   | `tier` | ✓ | ✓ | ✓ |
   | `kai` | ✓ | ✓ | ✓ |
   | `riskScore` | — | ✓ | ✓ |
   | `consensusStrength` | — | ✓ | ✓ |
   | `markets_queried` | — | ✓ | ✓ |
   | `markets_alias_used` | — | ✓ | ✓ |
   | `sharpBookMovementConfirmed` | — | ✓ | ✓ |
   | `lineHistory` | — | — | ✓ |
   | `scoreBreakdown` | — | — | ✓ |

3. **Add a `toRationale()` function** for `minimal` mode that produces plain English:
   ```js
   function toRationale(row) {
     if (row.tier === 'TIER 1' && row.kai === 'BET') {
       return `Strong bet on ${row.selection}. ${row.edge.toFixed(2)}% edge, low risk, sharp books confirm.`;
     }
     // ... etc
   }
   ```

4. **Update `verbosity` param documentation** in tool definitions (Phase 6).

5. **Tests:**
   - `test/verbosity-contracts.test.js` — new file
   - Test: each verbosity level returns the expected field set
   - Test: `toRationale()` produces non-empty string for all tier/kai combinations

### Acceptance Criteria

- [ ] All 26 tools honor `verbosity` param consistently
- [ ] `minimal` mode returns plain-English rationales
- [ ] New test file with verbosity contract assertions
- [ ] Token cost: `minimal` responses are 60%+ smaller than `full`

---

## PHASE 8: Test Suite Expansion (P1)

**Effort:** 4-6 hours | **Risk:** Low | **Subagents:** 3 (parallel)
**Files touched:** 5+ new test files

### Subagent 1: Live API contract tests

Create `test/contract-live.test.js` with tests that hit the live API and validate:

```js
test('screen returns populated edge for MLB Moneyline', async () => { ... });
test('screen returns populated tier for NHL Total Goals', async () => { ... });
test('market alias "Total" resolves to "Total Goals" for NHL', async () => { ... });
test('market alias "Spread" resolves to "Puck Line" for NHL', async () => { ... });
test('health_status returns token expiry > 1800 seconds', async () => { ... });
test('freshness.newestAgeMs > 0 on healthy response', async () => { ... });
```

Add 30+ contract tests covering every tool's happy path.

### Subagent 2: Edge case + error tests

Create `test/error-handling.test.js` with:
- Each error code (AUTH_EXPIRED, BACKEND_DOWN, RATE_LIMITED, etc.)
- Each recovery instruction is present
- Empty response handling
- Malformed input handling
- Network timeout handling
- Auth failure handling
- Rate limit handling

Add 25+ error tests.

### Subagent 3: Performance + load tests

Create `test/performance.test.js` with:
- Latency: each tool returns within 5 seconds
- Cache hit: repeated call within TTL is 10x faster
- Compact vs full: `compact=true` is 90%+ smaller
- Multi-market: `markets=[]` with 3 markets is < 3x single market latency

Add 15+ performance tests.

### Acceptance Criteria

- [ ] 100+ new tests across 3 new test files
- [ ] Total test count: 700+ (target)
- [ ] All tests pass: `npm test` exit 0
- [ ] Coverage: lines 75%+, functions 80%+, branches 65%+ (per `c8` config)

---

## PHASE 9: Documentation + Changelog (P2)

**Effort:** 2 hours | **Risk:** Zero | **Subagents:** 1
**Files touched:** 5+ docs files

### Tasks

1. **Update `README.md`:**
   - Add "v1.3.0 — Market Freshness Overhaul" section
   - Update tool count (now 26 with new fields)
   - Add "Market Name Aliases" section with the alias table
   - Add "Migration from 1.x to 2.0" section
   - Add "Token Management" section
   - Update example queries to use new fields

3. **Update `CHANGELOG.md`** with full v1.3.0 entry:

   ```markdown
   ## [1.3.0] — 2026-06-XX
   
   ### BREAKING CHANGES (minor release with breaking field contract)
   - `/screen` endpoint now returns `edge`, `tier`, `kai` fields (were null in 1.2.0 fallback mode)
   - `markets_queried` field moved to top-level response (was nested in resultMeta)
   - Token storage format changed: now includes `expiresAt` and `lastRefreshed`
   - `freshnessFallbackUsed` is now `false` on healthy responses
   
   ### ADDED
   - Market name normalization with alias resolution
   - Cross-book consensus for alt markets (Run Line, Puck Line, Total Goals, etc.)
   - `consensusStrength` field on all ranked rows
   - `markets_alias_used` field in resultMeta
   - Token persistence layer with auto-refresh
   - 100+ new tests (583 → 700+)
   - Per-league per-market book availability matrix
   
   ### FIXED
   - `freshnessFallbackUsed: true` bug on all responses
   - Scoring engine short-circuiting on missing timestamps
   - Token expiry 196s → 1800s+
   - Cross-book consensus missing for non-Moneyline markets
   
   ### MIGRATION
   See `docs/MIGRATION-1.3.md` for upgrade guide.
   ```

3. **Create `docs/MIGRATION-1.3.md`:**
   - From 1.x to 2.0 step-by-step
   - Field rename map
   - Code examples showing old vs new

4. **Update `docs/HERMES_SKILL.md`:**
   - Add new market names to the example
   - Add token management section
   - Update tool descriptions

5. **Update `docs/AGENT_PROMPT.md`:**
   - Add market alias reference
   - Add verbosity example
   - Add freshness field explanation

2. **Update `SETUP.md`:**
   - Add "Upgrading from 1.x" section
   - Add troubleshooting for freshness fallback

7. **Regenerate `docs/openapi.json`:**
   ```bash
   npm run docs:openapi
   ```

### Acceptance Criteria

- [ ] README.md has v2.0.0 section
- [ ] CHANGELOG.md has full v2.0.0 entry
- [ ] `docs/MIGRATION-2.0.md` exists with upgrade guide
- [ ] `docs/openapi.json` regenerated
- [ ] All other docs updated

---

## PHASE 10: Release + Verification (FINAL)

**Effort:** 1-2 hours | **Risk:** Low | **Subagents:** 0
**Files touched:** 4-5

### Tasks

1. **Pre-release checklist:**
   - [ ] All 9 GitHub issues closed
   - [ ] `npm test` passes
   - [ ] `npm run lint` passes
   - [ ] `npm run check:version` passes
   - [ ] `npm run audit:sharp-research` passes
   - [ ] `npm run smoke:live` passes (7-day run is ideal)
   - [ ] `npm run smoke:player-context` passes
   - [ ] Coverage thresholds met (lines 75%, functions 80%, branches 65%)
   - [ ] `docs/openapi.json` regenerated

3. **Bump version:**
   ```bash
   # Manual edit (npm version minor would also work but we want CHANGELOG control)
   # Edit package.json: "version": "1.2.0" → "1.3.0"
   npm run check:version
   ```

4. **Create release commit:**
   ```bash
   git add -A
   git commit -m "release: v1.3.0 — market freshness overhaul

   - Fix freshnessFallbackUsed bug (now false on healthy responses)
   - Restore edge/tier/kai population on /screen endpoint
   - Add market name normalization (Total → Total Goals for NHL, etc.)
   - Add cross-book consensus for alt markets
   - Add token persistence layer (1800s+ expiry, auto-refresh)
   - Add 100+ new tests (583 → 700+)
   - BREAKING: see CHANGELOG.md and docs/MIGRATION-1.3.md

   Closes #1, #2, #3, #4, #5, #6, #7, #8, #9"
   ```

5. **Tag the release:**
   ```bash
   git tag -a v1.3.0 -m "v1.3.0 — Market Freshness Overhaul"
   git push origin release/v1.3.0-market-freshness-overhaul --tags
   ```

6. **Create GitHub release:**
   - Go to https://github.com/j17drake/propprofessor-mcp/releases
   - Create release from `v1.3.0` tag
   - Title: "v1.3.0 — Market Freshness Overhaul"
   - Body: copy from CHANGELOG.md
   - Mark as "minor" release with breaking changes documented

6. **Verify in production:**
   - Pull latest in the user config: `cd /Users/jamesdrake/Documents/workspace/propprofessor-mcp && git pull origin release/v2.0.0-market-freshness-overhaul`
   - Update Hermes config to use the new release branch
   - Restart MCP: `pkill -f propprofessor-mcp && cd /Users/jamesdrake/Documents/workspace/propprofessor-mcp && node scripts/propprofessor-mcp-server.js &`
   - Run live query to verify: `mcp_propprofessor_health_status`
   - Verify all 10 goals (G1-G10) are met

7. **Post-release cleanup:**
   - Close any open issues labeled `v1.3.0`
   - Update project board
   - Send summary to user via Telegram

### Acceptance Criteria

- [ ] v1.3.0 tagged and released on GitHub
- [ ] All G1-G10 goals met
- [ ] Live verification successful (no live smoke required per user)
- [ ] No regressions in 583 baseline tests
- [ ] Coverage thresholds met

---

## Subagent Prompts (Copy-Paste Ready)

### Phase 1 Subagent 1: Freshness Investigation

```
GOAL: Diagnose the root cause of `freshnessFallbackUsed: true` in the PropProfessor MCP responses.

CONTEXT: 
- Repo: /Users/jamesdrake/Documents/workspace/propprofessor-mcp
- Current version: 1.2.0
- Test count: 583 passing
- Branch: fix/novig-screen-research-and-filtering
- Recent debug session: 2026-06-09 — every /screen response shows freshnessFallbackUsed: true
- Debug report: /Users/jamesdrake/.hermes/propprofessor-mcp-debug-plan.md

DELIVERABLE: 
Write a diagnostic report at /Users/jamesdrake/.hermes/propprofessor-freshness-diag.md with:
1. Exact file:line where timestamps are lost or freshness falls back
2. Whether the upstream feed (via lib/propprofessor-api.js) provides timestamps
3. Whether the issue is in: API client, response parser, or scoring engine
4. Proposed fix location and approach
5. Risk assessment for the fix (low/medium/high)

DO NOT modify any files. Investigation only.

STEPS:
1. Read lib/propprofessor-api.js — find the response parsing
2. Read lib/propprofessor-screen-utils.js — find the freshness computation
3. Read lib/propprofessor-mcp-ranked-screen.js — find where freshness gates downstream
4. Run: git log --oneline -- lib/propprofessor-analysis.js
5. Test the live API: curl https://api.propprofessor.com/screen?league=MLB | head -100
6. Document the chain of data flow

REPORT TO ME with:
- The path to your diagnostic report
- One-sentence summary of the root cause
- Confidence level (low/medium/high) in the proposed fix
```

### Phase 1 Subagent 2: Freshness Fix Implementation

```
GOAL: Implement the fix for the freshnessFallbackUsed bug. Use the diagnostic from Subagent 1.

CONTEXT:
- Repo: /Users/jamesdrake/Documents/workspace/propprofessor-mcp
- Branch: fix/novig-screen-research-and-filtering
- Diagnostic report: /Users/jamesdrake/.hermes/propprofessor-freshness-diag.md (read first!)
- Tests: 583 currently passing, target 700+

DELIVERABLE:
- Working fix that makes freshnessFallbackUsed: false on healthy responses
- A new test file: test/freshness-fix.test.js with 5+ tests
- All 583 existing tests still pass

STEPS:
1. Read the diagnostic report from Subagent 1
2. Read the files identified as the fix location
3. Apply the fix:
   - Preserve timestamps in response transformation
   - Don't use 0 as default for newestAgeMs/oldestAgeMs
   - Compute real ages from real timestamps
4. Create test/freshness-fix.test.js with these tests:
   - parseScreenResponse returns real ages when upstream provides timestamps
   - parseScreenResponse returns null (not 0) when timestamps are missing
   - freshnessFallbackUsed is false on healthy responses
   - freshnessFallbackUsed is true on stale responses
   - Stale detection still works (correctly marks old data)
5. Run: npm test
6. Verify all 583 + 5 new tests pass

REPORT TO ME with:
- Files modified (list)
- Test count after fix
- Whether health_status now reports freshnessFallbackUsed: false (if you can test live)
```

### Phase 3 Subagent: Market Name Normalization

```
GOAL: Add market name alias resolution to the PropProfessor MCP.

CONTEXT:
- Repo: /Users/jamesdrake/Documents/workspace/propprofessor-mcp
- Branch: fix/novig-screen-research-and-filtering
- Issue: Querying market="Total" for NHL returns 0 rows. Should return Total Goals.
- 26 tools all take a market param. All need alias resolution.

DELIVERABLE:
- New MARKET_ALIASES map in lib/propprofessor-shared-utils.js
- New resolveMarketName(input, league) function
- All 26 tool entry points in scripts/propprofessor-mcp-server.js apply the resolver
- New test file: test/market-aliases.test.js with 15+ tests
- 700+ total tests passing

STEPS:
1. Build the alias map (see Phase 3 in plan for full mapping)
2. Create resolveMarketName function in lib/propprofessor-shared-utils.js
3. Apply the resolver at all entry points in scripts/propprofessor-mcp-server.js:
   - screen (line ~658)
   - screen_ranked (line ~680)
   - recommended_bets (line ~904)
   - staking_plan (line ~1036)
   - all_slates (line ~1102)
   - sharp_plays (line ~719)
   - novig_screen (line ~775)
   - ev_candidates (line ~1160)
   - find_best_price (line ~1266)
   - get_play_details (line ~1378)
4. Add markets_alias_used field to resultMeta when an alias was resolved
5. Create test/market-aliases.test.js with these test cases:
   - resolveMarketName('Total', 'NHL') returns 'Total Goals'
   - resolveMarketName('Total', 'MLB') returns 'Total Runs'
   - resolveMarketName('Total', 'NBA') returns 'Total Points'
   - resolveMarketName('Total', 'WNBA') returns 'Total Points'
   - resolveMarketName('Spread', 'NHL') returns 'Puck Line'
   - resolveMarketName('Spread', 'MLB') returns 'Run Line'
   - resolveMarketName('Moneyline', 'NBA') returns 'Moneyline'
   - resolveMarketName(undefined, 'MLB') returns 'Moneyline' (default)
   - resolveMarketName('total_goals', 'NHL') returns 'Total Goals'
   - resolveMarketName('puck_line', 'NHL') returns 'Puck Line'
   - resolveMarketName('Puck Line', 'NHL') returns 'Puck Line' (passthrough)
   - resolveMarketName('Unknown Market', 'NBA') returns 'Unknown Market' (passthrough)
   - Result includes wasAliased flag
6. Run npm test — verify 583 + 15+ pass

REPORT TO ME with:
- Files modified
- New test count
- Sample of 3 alias resolutions that now work (e.g., before vs after)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Freshness fix breaks scoring for legacy clients | Medium | High | Feature-flag the fix; keep both paths |
| Market aliases resolve wrong name | Low | Medium | Comprehensive test coverage; explicit alias map |
| Token persistence has race condition | Medium | Medium | Use mutex/lock around token refresh |
| Tests fail on cross-platform (Linux CI) | Low | Low | Run CI before merge |
| Upstream feed genuinely doesn't send timestamps | High | High | Add fallback that still populates edge/tier from odds alone |
| `npm test` regressions | Medium | Medium | Run tests after every subagent commit |
| 700+ test count slips | Medium | Low | 100+ new tests is a stretch goal; 650+ is acceptable |

---

## Timeline Estimate

| Phase | Effort | Parallelism | Calendar Time |
|-------|--------|-------------|---------------|
| 0 | 30 min | 0 | 30 min |
| 1 | 4-6 hrs | 2 subagents | 3 hrs |
| 2 | 3-4 hrs | 1 subagent | 4 hrs |
| 3 | 2-3 hrs | 1 subagent | 3 hrs |
| 4 | 4-5 hrs | 2 subagents | 3 hrs |
| 5 | 2-3 hrs | 1 subagent | 3 hrs |
| 6 | 2 hrs | 1 subagent | 2 hrs |
| 7 | 3 hrs | 1 subagent | 3 hrs |
| 8 | 4-6 hrs | 3 subagents | 3 hrs |
| 9 | 2 hrs | 1 subagent | 2 hrs |
| 10 | 1-2 hrs | 0 | 2 hrs |
| **Total** | **28-36 hrs** | — | **~28 hrs** |

With 3 parallel subagents at peak: **~28 hours calendar time** = **3.5 working days**.

---

## Success Criteria Summary

- [ ] G1-G10 all met
- [ ] 700+ tests passing
- [ ] Zero lint errors
- [ ] Coverage thresholds met
- [ ] All 9 GitHub issues closed
- [ ] v2.0.0 tagged and released
- [ ] Live MCP restart successful
- [ ] Health check reports clean state
- [ ] User can query Run Line, Puck Line, Total Goals, Total Points and get full edge/tier/kai data
- [ ] Token persists across restarts

---

## Files That Will Be Touched

```
lib/propprofessor-api.js                          (Phase 1, 2, 5)
lib/propprofessor-analysis.js                     (Phase 2)
lib/propprofessor-shared-utils.js                 (Phase 3, 5)
lib/propprofessor-screen-utils.js                 (Phase 1, 2, 4)
lib/propprofessor-mcp-ranked-screen.js            (Phase 7)
lib/propprofessor-sharp-books.js                  (Phase 4)
lib/propprofessor-tool-definitions.js             (Phase 6)
lib/propprofessor-formatter.js                    (Phase 7)
scripts/propprofessor-mcp-server.js               (Phase 3, 5, 6, 7)
scripts/query-propprofessor.js                    (Phase 3)
test/freshness-fix.test.js                        (Phase 1) — NEW
test/market-aliases.test.js                       (Phase 3) — NEW
test/token-manager.test.js                        (Phase 5) — NEW
test/contract-live.test.js                        (Phase 8) — NEW
test/error-handling.test.js                       (Phase 8) — NEW
test/performance.test.js                          (Phase 8) — NEW
test/verbosity-contracts.test.js                  (Phase 7) — NEW
package.json                                      (Phase 10)
CHANGELOG.md                                      (Phase 9, 10)
README.md                                         (Phase 9)
SETUP.md                                          (Phase 9)
docs/HERMES_SKILL.md                              (Phase 9)
docs/AGENT_PROMPT.md                              (Phase 9)
docs/MARKET-BOOK-AVAILABILITY.md                  (Phase 4) — NEW
docs/MIGRATION-2.0.md                             (Phase 9) — NEW
docs/openapi.json                                 (Phase 6, 9) — REGENERATED
```

**Total files:** 25 (5 new, 20 modified)

---
---
## Decisions (Confirmed 2026-06-09)

1. ✅ **Branch created immediately** — `release/v1.3.0-market-freshness-overhaul` from main
2. ✅ **Phase 4 in scope** — full 10 phases
3. ✅ **Version 1.3.0** (minor bump, not 2.0) — breaking changes documented in CHANGELOG
4. ✅ **Skip live smoke** — trust unit tests, no 7-day run
5. ✅ **Memory saved** — repo + branch + version (no full plan)
