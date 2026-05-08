'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { hydrateScreenRowsWithHistory } = require('../lib/propprofessor-screen-history');

function makeClient(queryFn) {
  return { queryOddsHistory: queryFn || (async () => []) };
}

function makeRow(overrides = {}) {
  return {
    gameId: 'game-1',
    selectionId: 'sel-1',
    book: 'DraftKings',
    pick: 'Lakers',
    game: 'Lakers vs Celtics',
    odds: '-110',
    ...overrides
  };
}

describe('hydrateScreenRowsWithHistory', () => {
  it('returns source rows as-is when client is null', async () => {
    const rows = [makeRow()];
    const result = await hydrateScreenRowsWithHistory(rows, { client: null });
    assert.deepEqual(result, rows);
  });

  it('returns source rows as-is when client is missing queryOddsHistory', async () => {
    const rows = [makeRow()];
    const result = await hydrateScreenRowsWithHistory(rows, { client: {} });
    assert.deepEqual(result, rows);
  });

  it('returns empty array when rows is empty', async () => {
    const client = makeClient();
    const result = await hydrateScreenRowsWithHistory([], { client });
    assert.deepEqual(result, []);
  });

  it('returns empty array when rows is not an array', async () => {
    const client = makeClient();
    const result = await hydrateScreenRowsWithHistory(null, { client });
    assert.deepEqual(result, []);
  });

  it('filters out null and non-object rows', async () => {
    const client = makeClient(async () => []);
    const validRow = makeRow();
    const result = await hydrateScreenRowsWithHistory([null, validRow, 'string', 42, undefined], { client });
    assert.equal(result.length, 1);
  });

  it('returns rows that already have lineHistory with 2+ entries unchanged with lineHistoryAvailable=true', async () => {
    const client = makeClient(async () => {
      throw new Error('should not call');
    });
    const row = makeRow({
      lineHistory: [
        { odds: -110, ts: 1 },
        { odds: -120, ts: 2 }
      ],
      lineHistorySource: 'test_source',
      lineHistoryLookbackHours: 12,
      normalizedSelectionId: 'norm-1',
      historyGameId: 'hist-game-1',
      historyMatchedBy: 'exact',
      historyMatchKey: 'key-1'
    });
    const [result] = await hydrateScreenRowsWithHistory([row], { client });
    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(result.lineHistorySource, 'test_source');
    assert.equal(result.lineHistoryLookbackHours, 12);
    assert.equal(result.normalizedSelectionId, 'norm-1');
    assert.equal(result.historyGameId, 'hist-game-1');
    assert.equal(result.historyMatchedBy, 'exact');
    assert.equal(result.historyMatchKey, 'key-1');
    assert.equal(result.lineHistory.length, 2);
  });

  it('defaults lineHistorySource to screen_payload when row already has history', async () => {
    const client = makeClient(async () => {
      throw new Error('should not call');
    });
    const row = makeRow({
      lineHistory: [{ odds: -110 }, { odds: -120 }]
    });
    const [result] = await hydrateScreenRowsWithHistory([row], { client });
    assert.equal(result.lineHistorySource, 'screen_payload');
  });

  it('defaults lineHistoryLookbackHours from options when row does not specify', async () => {
    const client = makeClient(async () => {
      throw new Error('should not call');
    });
    const row = makeRow({
      lineHistory: [{ odds: -110 }, { odds: -120 }]
    });
    const [result] = await hydrateScreenRowsWithHistory([row], { client, lookbackHours: 48 });
    assert.equal(result.lineHistoryLookbackHours, 48);
  });

  it('hydrates rows by calling resolveHistoryForEntity through client.queryOddsHistory', async () => {
    const calls = [];
    const client = makeClient(async (params) => {
      calls.push(params);
      return [
        { odds: -110, start_ts: 1 },
        { odds: -120, start_ts: 2 }
      ];
    });
    const row = makeRow({ gameId: 'game-abc', selectionId: 'sel-abc' });
    const [result] = await hydrateScreenRowsWithHistory([row], { client, lookbackHours: 24 });

    assert.equal(result.lineHistoryAvailable, true);
    assert.equal(result.lineHistorySource, 'odds_history');
    assert.equal(result.lineHistoryLookbackHours, 24);
    assert.ok(Array.isArray(result.lineHistory));
  });

  it('resolves from cache — identical cache keys only make one query', async () => {
    let queryCount = 0;
    const client = makeClient(async () => {
      queryCount++;
      return [
        { odds: -110, start_ts: 1 },
        { odds: -120, start_ts: 2 }
      ];
    });

    const rows = [
      makeRow({ gameId: 'game-same', selectionId: 'sel-same', book: 'DK' }),
      makeRow({ gameId: 'game-same', selectionId: 'sel-same', book: 'DK' }),
      makeRow({ gameId: 'game-same', selectionId: 'sel-same', book: 'DK' })
    ];

    const results = await hydrateScreenRowsWithHistory(rows, { client });
    assert.equal(queryCount, 1);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal(r.lineHistoryAvailable, true);
    }
  });

  it('makes separate queries for different cache keys', async () => {
    const queriedKeys = [];
    const client = makeClient(async () => {
      queriedKeys.push(true);
      return [
        { odds: -110, start_ts: 1 },
        { odds: -120, start_ts: 2 }
      ];
    });

    const rows = [
      makeRow({ gameId: 'game-a', selectionId: 'sel-a' }),
      makeRow({ gameId: 'game-b', selectionId: 'sel-b' })
    ];

    const results = await hydrateScreenRowsWithHistory(rows, { client });
    assert.equal(queriedKeys.length, 2);
    assert.equal(results.length, 2);
  });

  it('handles history resolution errors gracefully returning lineHistoryAvailable=false', async () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks = [];
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    const client = makeClient(async () => {
      throw new Error('API timeout');
    });

    const row = makeRow({ gameId: 'game-err', selectionId: 'sel-err' });
    const [result] = await hydrateScreenRowsWithHistory([row], { client });

    process.stderr.write = originalWrite;

    assert.equal(result.lineHistoryAvailable, false);
    assert.equal(result.lineHistorySource, null);
    assert.ok(Array.isArray(result.lineHistory));
    assert.equal(result.lineHistory.length, 0);

    const stderrOutput = stderrChunks.join('');
    assert.ok(stderrOutput.includes('API timeout'));
  });

  it('sets lineHistoryAvailable=false when resolveHistoryForEntity returns no history', async () => {
    const client = makeClient(async () => []);
    const row = makeRow({ gameId: 'game-nohist', selectionId: 'sel-nohist' });
    const [result] = await hydrateScreenRowsWithHistory([row], { client });

    assert.equal(result.lineHistoryAvailable, false);
    assert.ok(Array.isArray(result.lineHistory));
    assert.equal(result.lineHistory.length, 0);
  });

  it('limits concurrency — with concurrency=2 it does not exceed 2 in-flight', async () => {
    let maxInFlight = 0;
    let currentInFlight = 0;

    const client = makeClient(async () => {
      currentInFlight++;
      if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
      await new Promise((resolve) => setTimeout(resolve, 50));
      currentInFlight--;
      return [
        { odds: -110, start_ts: 1 },
        { odds: -120, start_ts: 2 }
      ];
    });

    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ gameId: `game-conc-${i}`, selectionId: `sel-conc-${i}` })
    );

    const results = await hydrateScreenRowsWithHistory(rows, { client, concurrency: 2 });

    assert.equal(results.length, 10);
    assert.ok(maxInFlight <= 2, `Expected max 2 in-flight but got ${maxInFlight}`);
  });

  it('respects concurrency=1 for serial execution', async () => {
    const order = [];
    const client = makeClient(async ({ gameId }) => {
      order.push(gameId);
      return [
        { odds: -110, start_ts: 1 },
        { odds: -120, start_ts: 2 }
      ];
    });

    const rows = [
      makeRow({ gameId: 'game-ser-1', selectionId: 'sel-ser-1' }),
      makeRow({ gameId: 'game-ser-2', selectionId: 'sel-ser-2' }),
      makeRow({ gameId: 'game-ser-3', selectionId: 'sel-ser-3' })
    ];

    await hydrateScreenRowsWithHistory(rows, { client, concurrency: 1 });
    assert.deepEqual(order, ['game-ser-1', 'game-ser-2', 'game-ser-3']);
  });

  it('preserves original row properties in hydrated results', async () => {
    const client = makeClient(async () => [
      { odds: -110, start_ts: 1 },
      { odds: -120, start_ts: 2 }
    ]);
    const row = makeRow({ gameId: 'game-prop', selectionId: 'sel-prop', customField: 'hello' });
    const [result] = await hydrateScreenRowsWithHistory([row], { client });

    assert.equal(result.customField, 'hello');
    assert.equal(result.gameId, 'game-prop');
    assert.equal(result.selectionId, 'sel-prop');
    assert.equal(result.lineHistoryAvailable, true);
  });
});
