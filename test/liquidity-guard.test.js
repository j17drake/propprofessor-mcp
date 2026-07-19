'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Test the liquidity guard that downgrades thin-consensus Tier 1 plays.
 *
 * We test the guard through its public wiring in rankLeagueScreenRows
 * using the standard screen-payload fixtures.
 */

const { rankLeagueScreenRows, applyLiquidityGuard } = require('../lib/screen-ranker');
const { NBA_MONEYLINE_PAYLOAD } = require('./fixtures/screen-payloads');

describe('applyLiquidityGuard', () => {
  it('leaves Tier 2+ plays untouched', () => {
    const rows = rankLeagueScreenRows(NBA_MONEYLINE_PAYLOAD, { league: 'NBA', market: 'Moneyline' });
    for (const row of rows) {
      if (row.confidenceTier === 'TIER 1') continue;
      assert.equal(row.liquidityFloorApplied, undefined, `non-Tier1 row '${row.selection}' got flagged`);
      assert.equal(row.liquidityExempted, undefined, `non-Tier1 row '${row.selection}' got exempted`);
    }
  });

  it('Tier 1 with 0-1 books gets downgraded to TIER 3 CONSIDER', () => {
    // Create a synthetic Tier 1 row with thin consensus
    const fakeRow = {
      confidenceTier: 'TIER 1',
      displayTier: 'TIER 1',
      kaiCall: 'BET',
      consensusBookCount: 1,
      consensusEdge: 1.2,
      movementDisposition: 'supportive_clean',
      selection: 'Test Team',
      game: 'Test vs Fake'
    };
    applyLiquidityGuard([fakeRow]);
    assert.equal(fakeRow.confidenceTier, 'TIER 3', 'should be downgraded to TIER 3');
    assert.equal(fakeRow.kaiCall, 'CONSIDER', 'kaiCall should be CONSIDER');
    assert.equal(fakeRow.liquidityFloorApplied, true, 'should have liquidityFloorApplied flag');
  });

  it('Tier 1 with 0 books gets downgraded', () => {
    const fakeRow = {
      confidenceTier: 'TIER 1',
      displayTier: 'TIER 1',
      kaiCall: 'BET',
      consensusBookCount: 0,
      consensusEdge: 0.5,
      movementDisposition: 'supportive_clean',
      selection: 'Test Team',
      game: 'Test vs Fake'
    };
    applyLiquidityGuard([fakeRow]);
    assert.equal(fakeRow.confidenceTier, 'TIER 3', '0-book Tier 1 should be downgraded');
  });

  it('Tier 1 with 2+ books is never downgraded by liquidity', () => {
    const fakeRow = {
      confidenceTier: 'TIER 1',
      displayTier: 'TIER 1',
      kaiCall: 'BET',
      consensusBookCount: 2,
      consensusEdge: 1.0,
      movementDisposition: 'supportive_clean',
      selection: 'Test Team',
      game: 'Test vs Fake'
    };
    applyLiquidityGuard([fakeRow]);
    assert.equal(fakeRow.confidenceTier, 'TIER 1', '2-book Tier 1 should stay');
    assert.equal(fakeRow.liquidityFloorApplied, undefined, 'should not be flagged as floor');
  });

  it('Tier 1 with 1 book but high edge + clean movement is exempted, not downgraded', () => {
    const fakeRow = {
      confidenceTier: 'TIER 1',
      displayTier: 'TIER 1',
      kaiCall: 'BET',
      consensusBookCount: 1,
      consensusEdge: 3.0,
      movementDisposition: 'supportive_clean',
      selection: 'Test Team',
      game: 'Test vs Fake'
    };
    applyLiquidityGuard([fakeRow]);
    assert.equal(fakeRow.confidenceTier, 'TIER 1', 'high-edge single-book Tier 1 should stay TIER 1');
    assert.equal(fakeRow.liquidityExempted, true, 'should be marked as exempted');
    assert.equal(fakeRow.liquidityFloorApplied, undefined, 'should not be flagged as floor');
  });

  it('Tier 1 with 1 book, high edge but bouncy movement is NOT exempted', () => {
    const fakeRow = {
      confidenceTier: 'TIER 1',
      displayTier: 'TIER 1',
      kaiCall: 'BET',
      consensusBookCount: 1,
      consensusEdge: 3.0,
      movementDisposition: 'supportive_bouncy',
      selection: 'Test Team',
      game: 'Test vs Fake'
    };
    applyLiquidityGuard([fakeRow]);
    assert.equal(fakeRow.confidenceTier, 'TIER 3', 'bouncy + single-book should be downgraded');
    assert.equal(fakeRow.liquidityFloorApplied, true, 'should be flagged as floor');
  });

  it('handles empty array gracefully', () => {
    assert.doesNotThrow(() => applyLiquidityGuard([]));
  });

  it('handles non-array gracefully', () => {
    assert.doesNotThrow(() => applyLiquidityGuard(null));
    assert.doesNotThrow(() => applyLiquidityGuard(undefined));
  });
});

describe('liquidity guard integrated with rankLeagueScreenRows', () => {
  it('real NBA payload produces reasonCodes on all rows', () => {
    const rows = rankLeagueScreenRows(NBA_MONEYLINE_PAYLOAD, { league: 'NBA', market: 'Moneyline' });
    for (const row of rows) {
      assert.ok(Array.isArray(row.reasonCodes), `row '${row.selection || row.game}' missing reasonCodes`);
    }
  });
});
