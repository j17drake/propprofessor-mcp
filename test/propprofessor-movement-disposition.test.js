'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeMovementDisposition } = require('../lib/propprofessor-movement-disposition');

describe('computeMovementDisposition', () => {
  it('returns supportive_clean for green grade + supportive label', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'green',
      movementLabel: 'supportive',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive',
      peakAdverseClvPct: 0.5
    }), 'supportive_clean');
  });

  it('returns supportive_bouncy for green grade + V-shaped recovery', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'green',
      movementLabel: 'supportive',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive',
      peakAdverseClvPct: -3.2
    }), 'supportive_bouncy');
  });

  it('returns adverse_recent when recentSharpMoveDirection is adverse', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'supportive',
      recentSharpMoveDirection: 'adverse',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'adverse_recent');
  });

  it('returns adverse_full for red grade', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'red',
      movementLabel: 'supportive',
      recentSharpMoveDirection: 'adverse',
      fullWindowSharpMoveDirection: 'adverse'
    }), 'adverse_full');
  });

  it('returns insufficient when no history available', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'insufficient_history',
      recentSharpMoveDirection: 'insufficient_history',
      fullWindowSharpMoveDirection: 'insufficient_history'
    }), 'insufficient');
  });

  it('returns supportive_bouncy for yellow grade + supportive', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'supportive',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'supportive_bouncy');
  });

  it('returns adverse_recent for mixed label + adverse recent', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'mixed',
      recentSharpMoveDirection: 'adverse',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'adverse_recent');
  });

  it('returns supportive_bouncy for mixed label + supportive recent', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'mixed',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'supportive_bouncy');
  });

  it('returns adverse_full for adverse label', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'red',
      movementLabel: 'adverse',
      recentSharpMoveDirection: 'adverse',
      fullWindowSharpMoveDirection: 'adverse'
    }), 'adverse_full');
  });

  it('returns supportive_bouncy for recent_supportive_only + yellow grade', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'recent_supportive_only',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'supportive_bouncy');
  });

  it('returns supportive_clean for recent_supportive_only + green grade', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'green',
      movementLabel: 'recent_supportive_only',
      recentSharpMoveDirection: 'supportive',
      fullWindowSharpMoveDirection: 'supportive'
    }), 'supportive_clean');
  });

  it('returns insufficient when only fullDir insufficient but recent is ok', () => {
    assert.equal(computeMovementDisposition({
      movementGrade: 'yellow',
      movementLabel: 'insufficient_history',
      recentSharpMoveDirection: 'insufficient_history',
      fullWindowSharpMoveDirection: 'insufficient_history'
    }), 'insufficient');
  });

  it('returns insufficient for null/undefined row', () => {
    assert.equal(computeMovementDisposition(null), 'insufficient');
    assert.equal(computeMovementDisposition(undefined), 'insufficient');
    assert.equal(computeMovementDisposition({}), 'insufficient');
  });
});
