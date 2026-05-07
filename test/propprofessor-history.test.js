'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { findBestHistoryRow, normalizeHistoryPayload, resolveHistoryForEntity, getOddsHistoryStartTimestamp } = require('../lib/propprofessor-history');
const { getSharpBookComparisonSet } = require('../lib/propprofessor-sharp-books');

describe('propprofessor history matching', () => {
  it('does not resolve odds history from a weak book-only row match', async () => {
    let queried = false;
    const result = await resolveHistoryForEntity({
      client: {},
      target: { book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Orioles vs Red Sox', odds: '-130' },
      rows: [{ book: 'NoVigApp', pick: 'Portland Trail Blazers +5.5', game: 'Trail Blazers vs Warriors', odds: '+102', gameId: 'wrong-game', selectionId: 'wrong-selection' }],
      queryHistoryFn: async () => { queried = true; return [{ odds: -110 }, { odds: -130 }]; }
    });

    assert.equal(queried, false);
    assert.equal(result.lineHistoryAvailable, false);
    assert.equal(result.matchStrength.strong, false);
  });

  it('allows fallback matching when book and pick match plus game or odds matches', async () => {
    const calls = [];
    const result = await resolveHistoryForEntity({
      client: {},
      target: { book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-130' },
      rows: [{ book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-120', gameId: 'game-1', selectionId: 'selection-1' }],
      queryHistoryFn: async params => { calls.push(params); return [{ odds: -120 }, { odds: -140 }]; }
    });

    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(result.matchStrength.strong, true);
    assert.equal(calls[0].gameId, 'game-1');
  });

  it('queries backend odds history using the configured default lookback window', async () => {
    const calls = [];
    const fixedNowMs = Date.UTC(2026, 3, 26, 12, 0, 0);
    const result = await resolveHistoryForEntity({
      client: {},
      nowMs: fixedNowMs,
      target: { book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-130' },
      rows: [{ book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-130', gameId: 'game-1', selectionId: 'selection-1' }],
      queryHistoryFn: async params => { calls.push(params); return [{ odds: -120 }, { odds: -140 }]; }
    });

    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(calls[0].startTimestamp, Math.floor(fixedNowMs / 1000) - 6 * 60 * 60);
  });

  it('falls back to the default lookback window for invalid values', () => {
    const fixedNowMs = Date.UTC(2026, 3, 26, 12, 0, 0);
    assert.equal(
      getOddsHistoryStartTimestamp({ lookbackHours: 0, nowMs: fixedNowMs }),
      Math.floor(fixedNowMs / 1000) - 6 * 60 * 60
    );
  });

  it('uses target ids when the best matching backend row is missing resolvable ids', async () => {
    const calls = [];
    const result = await resolveHistoryForEntity({
      client: {},
      target: {
        book: 'NoVigApp',
        pick: 'Boston Celtics',
        game: 'Boston Celtics vs Philadelphia 76ers',
        odds: '-105',
        gameId: 'game-99',
        selectionId: 'selection-99'
      },
      rows: [{ book: 'NoVigApp', pick: 'Boston Celtics', game: 'Boston Celtics vs Philadelphia 76ers', odds: '-105' }],
      queryHistoryFn: async params => { calls.push(params); return [{ odds: -110 }, { odds: -105 }]; }
    });

    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(calls[0].gameId, 'game-99');
    assert.equal(calls[0].selectionId, 'selection-99');
  });

  it('flattens sportsbook-keyed odds history payloads', () => {
    const result = normalizeHistoryPayload({
      Rebet: [
        { odds: -118, start_ts: 1, liquidity: 20 },
        { odds: -112, start_ts: 2, liquidity: 30 }
      ],
      FanDuel: [
        { odds: -110, start_ts: 3, liquidity: 0 }
      ]
    });

    assert.equal(result.length, 3);
    assert.equal(result[0].book, 'Rebet');
    assert.equal(result[0].odds, -118);
    assert.equal(result[2].book, 'FanDuel');
  });

  it('passes preferred and sharp sportsbooks into odds-history hydration requests', async () => {
    const calls = [];
    const sharpBooks = getSharpBookComparisonSet({ league: 'NBA', market: 'Moneyline' });
    const result = await resolveHistoryForEntity({
      client: {},
      target: { book: 'NoVigApp', pick: 'Boston Celtics', game: 'Boston Celtics vs Miami Heat', odds: '-142' },
      rows: [{ book: 'NoVigApp', pick: 'Boston Celtics', game: 'Boston Celtics vs Miami Heat', odds: '-142', gameId: 'game-1', selectionId: 'Moneyline:Boston_Celtics' }],
      preferredBook: 'NoVigApp',
      sharpBooks,
      queryHistoryFn: async params => {
        calls.push(params);
        return { NoVigApp: [{ odds: -150, start_ts: 1 }, { odds: -142, start_ts: 2 }] };
      }
    });

    assert.equal(result.lineHistoryAvailable, true);
    assert.deepEqual(calls[0].sportsbooks, ['NoVigApp', ...sharpBooks]);
    assert.deepEqual(result.historySportsbooksRequested, ['NoVigApp', ...sharpBooks]);
  });
});
