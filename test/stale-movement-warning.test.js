'use strict';

const assert = require('node:assert');
const { describe, it } = require('node:test');

// Inline version of the stale movement warning heuristic
function staleMovementWarning(row) {
  const disposition = String(row.movementDisposition || '').toLowerCase();
  const tier = String(row.confidenceTier || '').toUpperCase();
  const cbk = Number(row.consensusBookCount) || 0;
  return (
    disposition.startsWith('adverse') &&
    (tier === 'TIER 1' || tier === 'TIER 2') &&
    cbk >= 10
  );
}

describe('staleMovementWarning heuristic', () => {
  it('flags adverse TIER 1 with high consensus', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_full',
        confidenceTier: 'TIER 1',
        consensusBookCount: 16
      }),
      true
    );
  });

  it('flags adverse TIER 2 with high consensus', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_full',
        confidenceTier: 'TIER 2',
        consensusBookCount: 15
      }),
      true
    );
  });

  it('flags adverse_recent TIER 1', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_recent',
        confidenceTier: 'TIER 1',
        consensusBookCount: 12
      }),
      true
    );
  });

  it('does NOT flag TIER 3 with high consensus', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_full',
        confidenceTier: 'TIER 3',
        consensusBookCount: 16
      }),
      false
    );
  });

  it('does NOT flag adverse TIER 1 with low consensus', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_full',
        confidenceTier: 'TIER 1',
        consensusBookCount: 4
      }),
      false
    );
  });

  it('does NOT flag supportive_clean', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'supportive_clean',
        confidenceTier: 'TIER 1',
        consensusBookCount: 16
      }),
      false
    );
  });

  it('handles missing fields gracefully', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: null,
        confidenceTier: undefined
      }),
      false
    );
  });

  // Real example: Bergs ML from the 2026-06-25 quick_screen
  it('matches the real Bergs ML case', () => {
    assert.strictEqual(
      staleMovementWarning({
        movementDisposition: 'adverse_full',
        confidenceTier: 'TIER 1',
        consensusBookCount: 16
      }),
      true
    );
  });
});
