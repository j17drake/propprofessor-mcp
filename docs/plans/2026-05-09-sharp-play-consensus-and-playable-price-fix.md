# Sharp Play Consensus and Playable Price Fix Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make PropProfessor surface plays that match James's actual NoVig criteria by separating market availability from consensus support, requiring independent sharp movement, and treating NoVig as needing a playable price instead of the best price.

**Architecture:** Keep ranked-row expansion and comparison-book counting in `lib/propprofessor-screen-utils.js`, strict/broad play classification in `lib/propprofessor-sharp-plays.js`, and MCP addon wiring in `lib/propprofessor-sharp-plays-service.js` plus `scripts/propprofessor-mcp-server.js`. Do not patch around this in prompts or UI first. Fix the row semantics and classification logic at the source, then expose clearer diagnostics through MCP so downstream agents stop misreading `consensusBookCount`.

**Tech Stack:** Node.js CommonJS, node:test, PropProfessor internal `/screen` routes, MCP stdio server, existing ranked-screen helpers and sharp-history machinery.

---

## Problem statement

Current behavior is mismatched with the desired betting workflow.

Verified examples from the live tool session:
- `Kyle Freeland Over 17.5 Pitcher Outs` showed `movementSourceBook: Pinnacle`, `consensusBookCount: 0`, while raw `/screen` confirmed the market existed on at least `NoVigApp`, `Pinnacle`, and `DraftKings`.
- `Spencer Strider Over 15.5 Pitcher Outs` showed `movementSourceBook: Pinnacle`, `consensusBookCount: 0`, while raw `/screen` confirmed the market existed on at least `NoVigApp`, `Pinnacle`, and `DraftKings`.
- `Jared Mccain Over 7.5 Player Points` showed `movementSourceBook: FanDuel`, `consensusBookCount: 0`, while raw `/screen` confirmed the market existed on at least `NoVigApp`, `FanDuel`, and `DraftKings`.

Current strict sharp-play logic hard-fails these because `classifySharpPlay()` requires:
- independent sharp movement
- `consensusBookCount >= minConsensusBookCount`
- price in band
- non-stale row

But `consensusBookCount` is currently computed from a narrow implied-probability filter in `lib/propprofessor-screen-utils.js`, not from raw market existence or broader same-side support. That makes some valid prop cases look like dead-board passes.

## Target behavior

For James's NoVig workflow:
- independent sharp movement must still be required
- target-book movement must not count as sharp support
- NoVig only needs a playable price, not the best price
- props must not be auto-killed only because a narrow `consensusBookCount` stays `0` when multiple books clearly post the same market
- MCP output must clearly distinguish:
  - how many books post the market
  - how many books support the side
  - which book supplied movement history
  - whether the NoVig price is best, playable, or bad

---

## Task 1: Add failing analysis tests that reproduce the misleading prop cases

**Objective:** Lock in the current bug-like semantics with concrete tests before changing logic.

**Files:**
- Modify: `test/propprofessor-analysis.test.js`

**Step 1: Write failing tests**

Add focused tests for three row fixtures modeled on the verified live cases:
- `Kyle Freeland Over 17.5 Pitcher Outs`
- `Spencer Strider Over 15.5 Pitcher Outs`
- `Jared Mccain Over 7.5 Player Points`

Each fixture must include:
- target book odds at `NoVigApp`
- at least 2 non-target books posting the same exact side/line
- `movementSourceBook` coming from a non-target book
- enough line-history context to show the row is not stale

Assert the current expanded/ranked row data exposes this contradiction:
```js
assert.equal(row.movementSourceBook, 'Pinnacle');
assert.equal(row.consensusBookCount, 0);
assert.equal(row.marketBookCount, undefined);
```

That last assertion should fail now because `marketBookCount` does not exist yet.

**Step 2: Run the test and verify failure**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-analysis.test.js -v
```

Expected:
- the new fixture assertions fail because `marketBookCount`, `supportBookCount`, and `executionQuality` do not exist yet

**Step 3: Commit nothing yet**

Do not commit until the implementation for this task is complete.

---

## Task 2: Split market availability from consensus support in ranked screen rows

**Objective:** Stop overloading `consensusBookCount` by adding explicit fields for raw market availability and same-side support.

**Files:**
- Modify: `lib/propprofessor-screen-utils.js`
- Modify: `test/propprofessor-analysis.test.js`

**Step 1: Add a helper in `lib/propprofessor-screen-utils.js`**

Near the existing consensus calculation in `expandScreenRow()`, add a helper like:

```js
function summarizeComparisonBooks(compBooks, oddsKey) {
  const availableBooks = compBooks.filter((item) => Number.isFinite(item?.odds?.[oddsKey]));
  return {
    marketBookCount: availableBooks.length,
    marketBooks: availableBooks.map((item) => item.book)
  };
}
```

For prop and side rows, also add a first-pass support summary using the same side/line books that have a valid implied probability:

```js
function summarizeSupportBooks(compBooks, oddsKey) {
  const supportBooks = compBooks.filter((item) =>
    Number.isFinite(americanOddsToImpliedProbability(item?.odds?.[oddsKey]))
  );
  return {
    supportBookCount: supportBooks.length,
    supportBooks: supportBooks.map((item) => item.book)
  };
}
```

**Step 2: Attach new row fields**

For both branches in `expandScreenRow()` add:
- `marketBookCount`
- `marketBooks`
- `supportBookCount`
- `supportBooks`

Leave `consensusBookCount` in place for now, but make it a compatibility field only.

**Step 3: Keep backward compatibility explicit**

Add an inline comment exactly above `consensusBookCount` assignment:

```js
// Backward-compatibility field. This is narrower than raw market availability.
```

**Step 4: Update tests**

Assert for the three fixture rows:
- `marketBookCount >= 2`
- `marketBooks` contains the expected comparison books
- `supportBookCount >= 2` when the exact side/line exists across those books
- `consensusBookCount` may still be 0 in the old logic until downstream classification is updated

**Step 5: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-analysis.test.js -v
```

Expected: pass.

**Step 6: Commit**

```bash
git add lib/propprofessor-screen-utils.js test/propprofessor-analysis.test.js
git commit -m "feat: split market availability from consensus support in ranked rows"
```

---

## Task 3: Add explicit NoVig execution-quality scoring

**Objective:** Enforce James's “playable, not necessarily best” rule in code.

**Files:**
- Modify: `lib/propprofessor-screen-utils.js`
- Modify: `test/propprofessor-analysis.test.js`

**Step 1: Write failing tests first**

Add tests covering three cases:
- target book is best price
- target book is slightly worse than best but still playable
- target book is clearly worse and should fail execution

Use simple fixtures where the target book is `NoVigApp` and the comparison books are `Pinnacle`, `DraftKings`, or `FanDuel`.

Expected fields:
```js
assert.equal(row.executionQuality, 'best');
assert.equal(row.executionQuality, 'playable');
assert.equal(row.executionQuality, 'bad');
```

**Step 2: Implement a small helper**

Add a helper such as:

```js
function classifyExecutionQuality({ targetOdds, comparisonOdds }) {
  const finite = comparisonOdds.filter(Number.isFinite);
  if (!Number.isFinite(targetOdds) || !finite.length) return 'unknown';
  const best = Math.max(...finite);
  if (targetOdds >= best) return 'best';
  if (targetOdds >= best - 10) return 'playable';
  return 'bad';
}
```

Adjust the threshold logic if favorite/dog polarity needs different handling, but keep version 1 simple and documented.

**Step 3: Attach row fields**

Expose on ranked rows:
- `targetBookOdds`
- `bestAvailableOdds`
- `executionQuality`

**Step 4: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-analysis.test.js -v
```

Expected: pass.

**Step 5: Commit**

```bash
git add lib/propprofessor-screen-utils.js test/propprofessor-analysis.test.js
git commit -m "feat: add playable-price execution quality for target books"
```

---

## Task 4: Refactor sharp-play classification to use support and execution quality instead of raw consensus count alone

**Objective:** Make prop classification match James's criteria.

**Files:**
- Modify: `lib/propprofessor-sharp-plays.js`
- Modify: `test/propprofessor-sharp-plays.test.js`

**Step 1: Write failing tests first**

Add tests for these scenarios:

Case A: prop should become a bet candidate
- `movementSourceBook` is non-target sharp book
- `movementLabel` is `supportive`
- `lineHistoryUsable = true`
- `executionQuality = 'playable'`
- `marketBookCount >= 2`
- `supportBookCount >= 1`
- old `consensusBookCount = 0`

Expected:
```js
assert.equal(classification.verdict, 'Bet candidate');
assert.deepEqual(classification.passReasons, []);
```

Case B: target-book-only movement still fails
- same as above, but `movementSourceBook = 'NoVigApp'`

Expected:
```js
assert.equal(classification.verdict, 'Pass');
assert.match(classification.passReasons.join(','), /movement_source_is_target_book/);
```

Case C: unplayable target price fails
- non-target movement is supportive
- `executionQuality = 'bad'`

Expected:
```js
assert.equal(classification.verdict, 'Pass');
assert.match(classification.passReasons.join(','), /playable_price_failed/);
```

**Step 2: Implement minimal logic change**

In `classifySharpPlay()`:
- keep `movementIsSharpSourced`
- keep `sourceIsTargetBook`
- add:
  - `marketBookCount`
  - `supportBookCount`
  - `executionQuality`

For props, use a new rule block like:

```js
const isPropMarket = /player|pitcher/i.test(String(row.market || row.screenMarket || ''));
const marketOk = isPropMarket
  ? Number(row.marketBookCount || 0) >= 2
  : Number(row.consensusBookCount || 0) >= minConsensusBookCount;
const supportOk = isPropMarket
  ? Number(row.supportBookCount || 0) >= 1
  : Number(row.consensusBookCount || 0) >= minConsensusBookCount;
const executionOk = ['best', 'playable'].includes(String(row.executionQuality || ''));
```

Then classify using:
- movementIsSharpSourced
- marketOk
- supportOk
- executionOk
- non-stale row

**Step 3: Replace opaque pass reasons**

Add explicit reasons:
- `insufficient_market_availability`
- `insufficient_same_side_support`
- `playable_price_failed`

Do not remove existing reasons until tests are migrated.

**Step 4: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-sharp-plays.test.js -v
```

Expected: pass.

**Step 5: Commit**

```bash
git add lib/propprofessor-sharp-plays.js test/propprofessor-sharp-plays.test.js
git commit -m "feat: classify sharp plays by support and playable price"
```

---

## Task 5: Thread the new semantics through MCP addon responses

**Objective:** Make MCP results readable and debuggable for downstream agents.

**Files:**
- Modify: `lib/propprofessor-sharp-plays-service.js`
- Modify: `scripts/propprofessor-mcp-server.js`
- Modify: `test/propprofessor-mcp-server.test.js`
- Modify: `test/propprofessor-sharp-plays-contract.test.js`

**Step 1: Write failing tests**

Add tests that assert returned rows now include:
- `marketBookCount`
- `supportBookCount`
- `executionQuality`
- `targetBookOdds`
- `bestAvailableOdds`

And empty-state near misses expose the same fields in compact form where appropriate.

**Step 2: Implement**

In `toNearMissPreview()` add:
- `marketBookCount`
- `supportBookCount`
- `executionQuality`

In `resultMeta.workflow`, update text to mention:
- independent sharp movement required
- target book only needs a playable price

**Step 3: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-mcp-server.test.js test/propprofessor-sharp-plays-contract.test.js -v
```

Expected: pass.

**Step 4: Commit**

```bash
git add lib/propprofessor-sharp-plays-service.js scripts/propprofessor-mcp-server.js test/propprofessor-mcp-server.test.js test/propprofessor-sharp-plays-contract.test.js
git commit -m "feat: expose playable-price sharp-play diagnostics through MCP"
```

---

## Task 6: Add a user-facing strict mode for James-style NoVig play finding

**Objective:** Let callers intentionally request James's exact filtering semantics.

**Files:**
- Modify: `lib/propprofessor-tool-definitions.js`
- Modify: `scripts/propprofessor-mcp-server.js`
- Modify: `lib/propprofessor-sharp-plays-service.js`
- Modify: `test/propprofessor-mcp-server.test.js`

**Step 1: Write failing tests**

Add tests for new optional args such as:
- `requireIndependentSharpMovement: true`
- `requirePlayablePrice: true`
- `requireBestPrice: false`
- `minMarketBookCount: 2`
- `minSupportBookCount: 1`

Assert those flow through MCP and affect classification.

**Step 2: Implement the new args**

In tool definitions, add these schema properties.

In service/classification code, default to:
- `requireIndependentSharpMovement = true`
- `requirePlayablePrice = true`
- `requireBestPrice = false`
- `minMarketBookCount = 2` for props
- `minSupportBookCount = 1` for props

Keep existing defaults for main lines unless explicitly overridden.

**Step 3: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-mcp-server.test.js -v
```

Expected: pass.

**Step 4: Commit**

```bash
git add lib/propprofessor-tool-definitions.js scripts/propprofessor-mcp-server.js lib/propprofessor-sharp-plays-service.js test/propprofessor-mcp-server.test.js
git commit -m "feat: add james-style sharp movement and playable price mode"
```

---

## Task 7: Add regression tests using today’s exact examples end-to-end

**Objective:** Prevent this exact confusion from coming back.

**Files:**
- Modify: `test/query-propprofessor.test.js`
- Modify: `test/propprofessor-sharp-plays.test.js`
- Modify: `test/propprofessor-analysis.test.js`

**Step 1: Add end-to-end style fixtures**

Create fixtures named after the verified examples:
- `kyle_freeland_over_17_5_outs_fixture`
- `spencer_strider_over_15_5_outs_fixture`
- `jared_mccain_over_7_5_points_fixture`
- `tigers_ml_target_book_only_movement_fixture`

**Step 2: Assert desired outcomes**

For the first three, under James-style mode:
- they should not fail because of a fake “0 books” interpretation
- if movement is independently sharp and execution quality is playable, they should surface as `Bet candidate` or `Lean` depending on the final support thresholds

For Tigers ML target-book-only movement:
- still `Pass`
- still fails because movement source is target book

**Step 3: Run tests**

Run:
```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/query-propprofessor.test.js test/propprofessor-sharp-plays.test.js test/propprofessor-analysis.test.js -v
```

Expected: pass.

**Step 4: Commit**

```bash
git add test/query-propprofessor.test.js test/propprofessor-sharp-plays.test.js test/propprofessor-analysis.test.js
git commit -m "test: lock in james-style sharp-play examples"
```

---

## Task 8: Run the full verification suite and capture manual spot checks

**Objective:** Make sure the refactor does not silently break existing MCP ranking behavior.

**Files:**
- Modify: `docs/plans/2026-05-09-sharp-play-consensus-and-playable-price-fix.md` only if verification notes are needed

**Step 1: Run focused tests**

```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node --test test/propprofessor-analysis.test.js test/propprofessor-sharp-plays.test.js test/propprofessor-sharp-plays-contract.test.js test/propprofessor-mcp-server.test.js test/query-propprofessor.test.js -v
```

Expected: all pass.

**Step 2: Run the full suite**

```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
npm test
```

Expected: full pass.

**Step 3: Run manual CLI spot checks**

Use the local CLI after implementation:

```bash
cd /Users/jamesdrake/Desktop/propprofessor-mcp
node scripts/query-propprofessor.js sharp-plays --book NoVigApp --leagues MLB --markets "Pitcher Outs Recorded" --strict --includePasses --minConsensusBookCount 2 --maxAgeMs 900000
node scripts/query-propprofessor.js sharp-plays --book NoVigApp --leagues NBA --markets "Player Points" --strict --includePasses --maxAgeMs 900000
```

Manual verification checklist:
- rows with `movementSourceBook: Pinnacle` or `FanDuel` no longer look like “0-book” nonsense if other books clearly post the market
- target-book-only movement still fails
- NoVig prices slightly worse than best can still pass if marked `playable`
- MCP near misses explain exactly why a row failed

**Step 4: Final commit**

```bash
git add docs/plans/2026-05-09-sharp-play-consensus-and-playable-price-fix.md
git commit -m "docs: add sharp-play consensus and playable-price fix plan"
```

---

## Notes for the implementer

Code paths already identified from live inspection:
- `lib/propprofessor-screen-utils.js:597-645` computes the current comparison-book counts
- `lib/propprofessor-sharp-plays.js:139-194` hard-gates strict play classification using `consensusBookCount`
- `lib/propprofessor-sharp-plays-service.js:107-128` exposes the addon metadata and workflow text
- `test/propprofessor-analysis.test.js:515-517` already has a precedent for `consensusBookCount === 0` meaning “Insufficient comparison data”
- `test/propprofessor-sharp-plays.test.js:150-240` already asserts strict empty-state diagnostics and target-book-only movement behavior

Do not start by changing prompts or skills. Fix the code and tests first.

## Expected outcome after completion

After this plan is implemented, PropProfessor should stop producing this misleading combination for viable props:
- `movementSourceBook: Pinnacle`
- multiple books visibly posting the same side/line
- `consensusBookCount: 0`
- automatic hard `Pass`

Instead, the output should say something explicit like:
- `marketBookCount: 2`
- `supportBookCount: 2`
- `movementSourceBook: Pinnacle`
- `executionQuality: playable`
- `verdict: Bet candidate`

That matches James's stated criteria.
