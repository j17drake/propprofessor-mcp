'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { findBestHistoryRow, normalizeHistoryPayload, resolveHistoryForEntity } = require('../lib/propprofessor-history');

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

  it('queries backend odds history using the last 12 hours by default', async () => {
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
    assert.equal(calls[0].startTimestamp, Math.floor(fixedNowMs / 1000) - 12 * 60 * 60);
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

  it('resolves odds history from sportsbook-keyed payloads returned by the backend', async () => {
    const result = await resolveHistoryForEntity({
      client: {},
      target: { book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-130' },
      rows: [{ book: 'NoVigApp', pick: 'Baltimore Orioles', game: 'Baltimore Orioles vs Boston Red Sox', odds: '-130', gameId: 'game-1', selectionId: 'selection-1' }],
      queryHistoryFn: async () => ({
        NoVigApp: [{ odds: -120, start_ts: 1 }, { odds: -130, start_ts: 2 }],
        FanDuel: [{ odds: -125, start_ts: 3 }]
      })
    });

    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(result.lineHistory.length, 3);
    assert.equal(result.lineHistory[0].book, 'NoVigApp');
  });
});
