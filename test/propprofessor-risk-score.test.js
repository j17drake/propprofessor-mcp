'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  gradeRiskToTierAndCall,
  gradeMovementQuality,
  calculateRiskScore,
  getKaiCall,
  getConfidenceTier
} = require('../lib/propprofessor-risk-score');

describe('gradeRiskToTierAndCall — unified lookup', () => {
  it('red always → TIER 4, PASS regardless of risk', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('red', 1), { tier: 'TIER 4', kaiCall: 'PASS' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('red', 10), { tier: 'TIER 4', kaiCall: 'PASS' });
  });

  it('green + risk≤2 → TIER 1, BET', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 1), { tier: 'TIER 1', kaiCall: 'BET' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 2), { tier: 'TIER 1', kaiCall: 'BET' });
  });

  it('green + risk 3-4 → TIER 2, BET', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 3), { tier: 'TIER 2', kaiCall: 'BET' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 4), { tier: 'TIER 2', kaiCall: 'BET' });
  });

  it('green + risk 5-6 → TIER 2, CONSIDER (green upgrade)', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 5), { tier: 'TIER 2', kaiCall: 'CONSIDER' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 6), { tier: 'TIER 2', kaiCall: 'CONSIDER' });
  });

  it('green + risk≥7 → TIER 3, CONSIDER', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 7), { tier: 'TIER 3', kaiCall: 'CONSIDER' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('green', 9), { tier: 'TIER 3', kaiCall: 'CONSIDER' });
  });

  it('yellow + risk≤3 → TIER 2, BET', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 1), { tier: 'TIER 2', kaiCall: 'BET' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 3), { tier: 'TIER 2', kaiCall: 'BET' });
  });

  it('yellow + risk 4 → TIER 2, CONSIDER', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 4), { tier: 'TIER 2', kaiCall: 'CONSIDER' });
  });

  it('yellow + risk 5-6 → TIER 3, CONSIDER', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 5), { tier: 'TIER 3', kaiCall: 'CONSIDER' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 6), { tier: 'TIER 3', kaiCall: 'CONSIDER' });
  });

  it('yellow + risk≥7 → TIER 4, PASS', () => {
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 7), { tier: 'TIER 4', kaiCall: 'PASS' });
    assert.deepStrictEqual(gradeRiskToTierAndCall('yellow', 10), { tier: 'TIER 4', kaiCall: 'PASS' });
  });
});

describe('internal consistency — tier and kaiCall can never contradict', () => {
  it('BET call never comes with TIER 4', () => {
    const riskScores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const grades = ['green', 'yellow', 'red'];
    for (const grade of grades) {
      for (const riskScore of riskScores) {
        const result = gradeRiskToTierAndCall(grade, riskScore);
        if (result.kaiCall === 'BET') {
          assert.notStrictEqual(result.tier, 'TIER 4',
            `BET call with TIER 4 at grade=${grade} risk=${riskScore}`);
        }
        if (result.tier === 'TIER 4') {
          assert.strictEqual(result.kaiCall, 'PASS',
            `TIER 4 with non-PASS call at grade=${grade} risk=${riskScore}`);
        }
      }
    }
  });
});

describe('multiWindowScore graduated brackets', () => {
  // Build a YELLOW-grade item so the multi-window modifier has room to differentiate.
  // (Green-grade items with clean signals all floor to risk=1.)
  function itemWithWindowScore(score, otherFields = {}) {
    return {
      // movementLabel='neutral' (not supportive/adverse) → yellow grade
      movementLabel: 'neutral',
      executionQuality: 'playable',
      consensusBookCount: 3,    // <5 → fails strongConsensus green gate
      steamMove: false,
      clvProxyPct: 0,           // not >0 → fails positiveClv green gate
      consensusEdge: 1.0,       // >0.5% → edge modifier 0
      steamDirection: '',
      multiWindowScore: score,
      multiWindowInsufficientData: score === null,
      movementQuality: 'medium',
      movementQualityScore: 0.5, // <0.8 → fails highQuality green gate
      peakAdverseClvPct: 11,    // not adverse
      ...otherFields
    };
  }

  // YELLOW grade, all base modifiers neutral:
  // base 5, yellow+0, edge>0.5 +0, cons>=3 +1, exec playable +0, no steam +0, CLV> -1 +0
  // = 6. Then the multi-window modifier is the only variable.

  it('1.0 score gives strongest bonus', () => {
    const item = itemWithWindowScore(1.0);
    const score = calculateRiskScore(item);
    // 6 - 1.5 = 4.5 → 5
    assert.strictEqual(score, 5);
  });

  it('0.83 score gives strong bonus', () => {
    const item = itemWithWindowScore(0.83);
    const score = calculateRiskScore(item);
    // 6 - 1 = 5 → 5
    assert.strictEqual(score, 5);
  });

  it('0.66 score gives moderate bonus', () => {
    const item = itemWithWindowScore(0.66);
    const score = calculateRiskScore(item);
    // 6 - 0.5 = 5.5 → 6
    assert.strictEqual(score, 6);
  });

  it('0.50 is neutral', () => {
    const item = itemWithWindowScore(0.50);
    const score = calculateRiskScore(item);
    // 6 + 0 = 6 → 6
    assert.strictEqual(score, 6);
  });

  it('0.33 gives moderate penalty', () => {
    const item = itemWithWindowScore(0.33);
    const score = calculateRiskScore(item);
    // 6 + 0.5 = 6.5 → 7
    assert.strictEqual(score, 7);
  });

  it('0.16 gives strong penalty', () => {
    const item = itemWithWindowScore(0.16);
    const score = calculateRiskScore(item);
    // 6 + 1 = 7 → 7
    assert.strictEqual(score, 7);
  });

  it('0.0 gives strongest penalty', () => {
    const item = itemWithWindowScore(0.0);
    const score = calculateRiskScore(item);
    // 6 + 1.5 = 7.5 → 8
    assert.strictEqual(score, 8);
  });

  it('null score is no modifier when multiWindowInsufficientData is set', () => {
    const withNoData = itemWithWindowScore(null);
    const baseScore = calculateRiskScore(withNoData);
    // 6 + 0 = 6 → 6
    assert.strictEqual(baseScore, 6);
  });

  it('high-penalty bracket doesn\'t break clamp', () => {
    const item = itemWithWindowScore(0.0, {
      movementLabel: 'adverse',
      executionQuality: 'bad',
      consensusBookCount: 0,
      consensusEdge: -999,
      clvProxyPct: -4,
      steamMove: true,
      steamDirection: 'adverse',
      movementQuality: 'low',
      movementQualityScore: 0.2,
      peakAdverseClvPct: -5
    });
    const score = calculateRiskScore(item);
    // red grade + heavy penalties → should cap at 10
    assert.ok(score <= 10, `should not exceed 10, got ${score}`);
  });
});
