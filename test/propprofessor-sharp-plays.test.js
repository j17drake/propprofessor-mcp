'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSharpPlaysFromRankedRows,
  resolveTargetBook,
  resolveTargetBooks
} = require('../lib/propprofessor-sharp-plays');

describe('sharp play target book helpers', () => {
  it('resolves multiple target books while preserving legacy single-book fallback', () => {
    assert.deepEqual(resolveTargetBooks({ targetBooks: ['Fliff', 'Novig', 'NoVigApp', ''] }), ['Fliff', 'NoVigApp']);
    assert.deepEqual(resolveTargetBooks({ targetBooksCsv: 'Fliff,NoVig' }), ['Fliff', 'NoVigApp']);
    assert.deepEqual(resolveTargetBooks({ book: 'Rebet' }), ['Rebet']);
    assert.equal(resolveTargetBook({ targetBooks: ['Fliff', 'NoVigApp'] }), 'Fliff');
  });

  it('dedupes sharp plays by execution book plus play identity, not game only', () => {
    const base = {
      gameId: 'same-game',
      game: 'Stub Away vs Stub Home',
      scanLeague: 'NBA',
      scanMarket: 'Moneyline',
      pick: 'Stub Home',
      consensusBookCount: 2,
      lineHistoryUsable: true,
      movementMode: 'same_book',
      movementSourceBook: 'Pinnacle',
      movementLabel: 'supportive',
      movementQualityScore: 1,
      consensusEdge: 2,
      gatePassed: true
    };

    const result = buildSharpPlaysFromRankedRows([
      { ...base, book: 'NoVigApp', targetBook: 'NoVigApp', odds: 116 },
      { ...base, book: 'Fliff', targetBook: 'Fliff', odds: 108 }
    ], {
      targetBook: 'NoVigApp',
      minConsensusBookCount: 1,
      strict: true,
      limit: 10
    });

    assert.equal(result.length, 2);
    assert.deepEqual(result.map((row) => row.book).sort(), ['Fliff', 'NoVigApp']);
  });
});
