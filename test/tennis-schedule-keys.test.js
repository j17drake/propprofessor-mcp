'use strict';

/**
 * Regression test for the silent duplicate-key data corruption in
 * weekly-schedule-2026.js. Two bugs previously existed:
 *   1. `Rybakina` was defined twice (identical copy-paste) — ESLint no-dupe-keys.
 *   2. `Zhang` was defined twice: WTA (Qinwen Zheng) and ATP (Zhizhen Zhang).
 *      The ATP entry shadowed the WTA one, so `Zhang` (WTA) resolved as ATP.
 *
 * Both are now fixed: the duplicate Rybakina is removed, and the ATP player
 * is keyed as 'Zhang Zhizhen'. This test locks that in.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PLAYER_CIRCUIT } = require('../lib/tennis-schedule-data/weekly-schedule-2026');

describe('tennis schedule player keys', () => {
  it('WTA Zhang (Qinwen Zheng) resolves as WTA, not shadowed by ATP', () => {
    assert.ok(PLAYER_CIRCUIT['Zhang'], 'Zhang key must exist (WTA)');
    assert.equal(PLAYER_CIRCUIT['Zhang'].tour, 'wta', 'Zhang should be WTA (Qinwen Zheng)');
    assert.deepEqual(
      Object.keys(PLAYER_CIRCUIT).filter((k) => k === 'Zhang'),
      ['Zhang'],
      'exactly one Zhang key (WTA)'
    );
  });

  it('ATP Zhizhen Zhang is keyed distinctly as "Zhang Zhizhen"', () => {
    assert.ok(PLAYER_CIRCUIT['Zhang Zhizhen'], 'ATP player must survive under distinct key');
    assert.equal(PLAYER_CIRCUIT['Zhang Zhizhen'].tour, 'atp');
  });

  it('Rybakina is defined exactly once', () => {
    assert.equal(
      Object.keys(PLAYER_CIRCUIT).filter((k) => k === 'Rybakina').length,
      1,
      'Rybakina must not be a duplicate key'
    );
    assert.equal(PLAYER_CIRCUIT['Rybakina'].tour, 'wta');
  });
});
