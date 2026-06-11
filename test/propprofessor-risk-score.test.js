'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  getConfidenceTier,
  getConfidenceTierStable,
  clearTierCache,
  clearScoreTimeline,
  gradeMovementQuality,
  calculateRiskScore,
  getKaiCall,
  buildRationale
} = require('../lib/propprofessor-risk-score');

/** Helper: build a minimal enriched row for tier testing. */
function makeRow(overrides = {}) {
  return {
    league: 'NBA',
    game: 'Lakers @ Celtics',
    selection: 'Lakers',
    market: 'Moneyline',
    consensusEdge: 1.5,
    consensusBookCount: 8,
    movementLabel: 'supportive',
    movementQuality: 'high',
    movementQualityScore: 0.85,
    executionQuality: 'playable',
    steamMove: true,
    clvProxyPct: 2.5,
    multiWindowInsufficientData: true,
    ...overrides
  };
}

describe('getConfidenceTierStable', () => {
  beforeEach(() => {
    clearTierCache();
    clearScoreTimeline();
  });

  it('returns the same tier as getConfidenceTier for a fresh item', () => {
    const item = makeRow();
    const raw = getConfidenceTier(item);
    const stable = getConfidenceTierStable(item);
    assert.equal(stable, raw);
  });

  it('returns cached tier on repeated calls with same input', () => {
    const item = makeRow();
    const first = getConfidenceTierStable(item);
    const second = getConfidenceTierStable(item);
    assert.equal(first, second);
  });

  it('suppresses marginal tier changes (1 level, <3 risk points)', () => {
    // First call: assign a tier
    const item1 = makeRow({ consensusEdge: 1.5, consensusBookCount: 8 });
    const tier1 = getConfidenceTierStable(item1);

    // Second call: slightly different data that would produce a different raw tier
    // but the change is marginal (1 tier level, <3 risk points)
    const item2 = makeRow({
      consensusEdge: 1.3,
      consensusBookCount: 7,
      movementQualityScore: 0.75 // slightly lower
    });
    const tier2 = getConfidenceTierStable(item2);
    const rawTier2 = getConfidenceTier(item2);

    // If raw tier differs by 1 level, stable should keep the cached tier
    const tierLevel = { 'TIER 1': 1, 'TIER 2': 2, 'TIER 3': 3, 'TIER 4': 4 };
    const distance = Math.abs(tierLevel[rawTier2] - tierLevel[tier1]);

    if (distance <= 1) {
      // Marginal change — stable tier should match the first tier
      assert.equal(tier2, tier1, `Marginal change (distance=${distance}) should be suppressed`);
    }
    // If distance > 1, the change is significant and both would differ (that's fine)
  });

  it('allows significant tier changes (2+ levels)', () => {
    // First call: good data → TIER 1 or 2 (populates cache for hysteresis check)
    const goodItem = makeRow();
    getConfidenceTierStable(goodItem);

    // Second call: terrible data → should jump significantly
    const badItem = makeRow({
      consensusEdge: -2,
      consensusBookCount: 1,
      movementLabel: 'adverse',
      movementQuality: 'low',
      movementQualityScore: 0.1,
      executionQuality: 'bad',
      steamMove: false,
      clvProxyPct: -5,
      multiWindowInsufficientData: false,
      multiWindowScore: 0.1
    });
    const badTier = getConfidenceTierStable(badItem);
    const rawBadTier = getConfidenceTier(badItem);

    // TIER 4 should always be TIER 4 (adverse movement → red → TIER 4)
    assert.equal(badTier, 'TIER 4');
    // The stable tier should update to TIER 4 since the jump is significant
    assert.equal(badTier, rawBadTier);
  });

  it('clearTierCache resets all cached tiers', () => {
    const item = makeRow();
    getConfidenceTierStable(item); // populate cache
    clearTierCache();

    // After clear, should recompute from scratch
    const tier = getConfidenceTierStable(item);
    const raw = getConfidenceTier(item);
    assert.equal(tier, raw);
  });

  it('handles items with no identifiers gracefully', () => {
    const item = { consensusEdge: 1.5 }; // no game/selection/market
    const tier = getConfidenceTierStable(item);
    assert.ok(['TIER 1', 'TIER 2', 'TIER 3', 'TIER 4'].includes(tier));
  });
});

describe('buildRationale uses stable tier', () => {
  beforeEach(() => {
    clearTierCache();
    clearScoreTimeline();
  });

  it('rationale tier matches confidenceTier field when provided', () => {
    const item = makeRow({ confidenceTier: 'TIER 2' });
    const rationale = buildRationale(item);
    assert.ok(rationale.includes('TIER 2'), `Rationale should include TIER 2, got: ${rationale}`);
  });

  it('rationale falls back to stable tier when confidenceTier is missing', () => {
    const item = makeRow();
    const rationale = buildRationale(item);
    const stableTier = getConfidenceTierStable(item);
    assert.ok(rationale.includes(stableTier), `Rationale should include ${stableTier}, got: ${rationale}`);
  });
});

describe('getConfidenceTier wider bands', () => {
  it('green grade + risk 5 → TIER 2 (not TIER 3)', () => {
    // Build an item that's green grade but moderate risk
    // Green requires: supportive, high quality, playable, >=5 books, steam, positive CLV, sustained agreement
    const item = makeRow({
      movementLabel: 'supportive',
      movementQuality: 'high',
      movementQualityScore: 0.85,
      executionQuality: 'playable',
      steamMove: true,
      consensusBookCount: 8,
      clvProxyPct: 0.3,
      consensusEdge: 0.1, // low edge bumps risk
      multiWindowInsufficientData: true // no multi-window data = not blocked from green
    });

    const grade = gradeMovementQuality(item);
    assert.equal(grade, 'green');

    const risk = calculateRiskScore(item);
    const tier = getConfidenceTier(item);
    // Green grade with risk <= 6 should be TIER 2 (not TIER 3)
    assert.equal(tier, 'TIER 2', `Green grade + risk ${risk} should be TIER 2`);
    assert.ok(risk >= 2 && risk <= 6, `Expected risk 2-6, got ${risk}`);
  });

  it('PASS call always → TIER 4', () => {
    const item = makeRow({
      movementLabel: 'adverse',
      movementQuality: 'low',
      movementQualityScore: 0.1,
      executionQuality: 'bad',
      steamMove: false,
      consensusBookCount: 1,
      clvProxyPct: -5,
      consensusEdge: -2
    });

    const call = getKaiCall(item);
    assert.equal(call, 'PASS');
    const tier = getConfidenceTier(item);
    assert.equal(tier, 'TIER 4');
  });
});
