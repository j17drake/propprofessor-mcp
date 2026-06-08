'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRankedScreenResponse,
  getIncludeAll,
  getLimit,
  getLookbackHours,
  getRecentWindowHours,
  getMaxAgeMs,
  normalizeBookList,
  getDebugFlag,
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS
} = require('../lib/propprofessor-mcp-ranked-screen');

describe('normalizeBookList', () => {
  it('deduplicates book names', () => {
    const result = normalizeBookList(['DraftKings', 'FanDuel', 'DraftKings']);
    assert.deepEqual(result, ['DraftKings', 'FanDuel']);
  });

  it('trims whitespace from each entry', () => {
    const result = normalizeBookList(['  DK  ', ' FD ']);
    assert.deepEqual(result, ['DK', 'FD']);
  });

  it('filters out empty strings', () => {
    const result = normalizeBookList(['DK', '', '  ', 'FD']);
    assert.deepEqual(result, ['DK', 'FD']);
  });

  it('returns empty array for non-array input', () => {
    assert.deepEqual(normalizeBookList(null), []);
    assert.deepEqual(normalizeBookList(undefined), []);
    assert.deepEqual(normalizeBookList('DK'), []);
    assert.deepEqual(normalizeBookList(42), []);
  });

  it('coerces non-string entries to strings', () => {
    const result = normalizeBookList([123, true, 'DK']);
    assert.deepEqual(result, ['123', 'true', 'DK']);
  });
});

describe('getLimit', () => {
  it('returns explicit limit when valid', () => {
    assert.equal(getLimit({ limit: 25 }), 25);
    assert.equal(getLimit({ limit: '5' }), 5);
    assert.equal(getLimit({ limit: 1 }), 1);
  });

  it('returns 10 default for invalid or missing limit', () => {
    assert.equal(getLimit({}), 10);
    assert.equal(getLimit({ limit: -1 }), 10);
    assert.equal(getLimit({ limit: 0 }), 10);
    assert.equal(getLimit({ limit: 'abc' }), 10);
    assert.equal(getLimit({ limit: NaN }), 10);
    assert.equal(getLimit({ limit: Infinity }), 10);
  });
});

describe('getIncludeAll', () => {
  it('returns true by default', () => {
    assert.equal(getIncludeAll({}), true);
    assert.equal(getIncludeAll(), true);
  });

  it('respects explicit false', () => {
    assert.equal(getIncludeAll({ includeAll: false }), false);
  });

  it('respects explicit true', () => {
    assert.equal(getIncludeAll({ includeAll: true }), true);
  });

  it('coerces truthy/falsy values', () => {
    assert.equal(getIncludeAll({ includeAll: 0 }), false);
    assert.equal(getIncludeAll({ includeAll: 1 }), true);
  });
});

describe('getMaxAgeMs', () => {
  it('returns value when valid', () => {
    assert.equal(getMaxAgeMs({ maxAgeMs: 60000 }), 60000);
    assert.equal(getMaxAgeMs({ maxAgeMs: 0 }), 0);
    assert.equal(getMaxAgeMs({ maxAgeMs: '30000' }), 30000);
  });

  it('returns undefined for invalid or missing', () => {
    assert.equal(getMaxAgeMs({}), undefined);
    assert.equal(getMaxAgeMs({ maxAgeMs: -1 }), undefined);
    assert.equal(getMaxAgeMs({ maxAgeMs: 'abc' }), undefined);
    assert.equal(getMaxAgeMs({ maxAgeMs: NaN }), undefined);
    assert.equal(getMaxAgeMs({ maxAgeMs: Infinity }), undefined);
  });
});

describe('getLookbackHours', () => {
  it('returns explicit hours when valid', () => {
    assert.equal(getLookbackHours({ lookbackHours: 12 }), 12);
    assert.equal(getLookbackHours({ lookbackHours: '4' }), 4);
  });

  it('falls back to default when invalid or missing', () => {
    assert.equal(getLookbackHours({}), DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS);
    assert.equal(getLookbackHours({ lookbackHours: 0 }), DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS);
    assert.equal(getLookbackHours({ lookbackHours: -1 }), DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS);
    assert.equal(getLookbackHours({ lookbackHours: 'abc' }), DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS);
  });
});

describe('getRecentWindowHours', () => {
  it('returns explicit recentWindowHours when valid', () => {
    assert.equal(getRecentWindowHours({ recentWindowHours: 3, lookbackHours: 6 }), 3);
    assert.equal(getRecentWindowHours({ recentWindowHours: '1', lookbackHours: 6 }), 1);
  });

  it('falls back to lookbackHours when recentWindowHours is missing or invalid', () => {
    assert.equal(getRecentWindowHours({ lookbackHours: 4 }), 4);
    assert.equal(getRecentWindowHours({ recentWindowHours: 0, lookbackHours: 5 }), 5);
    assert.equal(getRecentWindowHours({ recentWindowHours: 'abc', lookbackHours: 2 }), 2);
  });
});

describe('getDebugFlag', () => {
  it('returns defaultValue for undefined/null', () => {
    assert.equal(getDebugFlag(undefined, true), true);
    assert.equal(getDebugFlag(undefined, false), false);
    assert.equal(getDebugFlag(null, true), true);
  });

  it('returns booleans as-is', () => {
    assert.equal(getDebugFlag(true), true);
    assert.equal(getDebugFlag(false), false);
  });

  it('treats non-zero numbers as true, zero as false', () => {
    assert.equal(getDebugFlag(1), true);
    assert.equal(getDebugFlag(42), true);
    assert.equal(getDebugFlag(0), false);
  });

  it('handles string true/false/on/off/yes/no', () => {
    assert.equal(getDebugFlag('true'), true);
    assert.equal(getDebugFlag('false'), false);
    assert.equal(getDebugFlag('on'), true);
    assert.equal(getDebugFlag('off'), false);
    assert.equal(getDebugFlag('yes'), true);
    assert.equal(getDebugFlag('no'), false);
  });

  it('handles case-insensitive and whitespace-padded strings', () => {
    assert.equal(getDebugFlag('  TRUE  '), true);
    assert.equal(getDebugFlag('Off'), false);
    assert.equal(getDebugFlag('  YES '), true);
  });

  it('returns defaultValue for unrecognized strings', () => {
    assert.equal(getDebugFlag('maybe', false), false);
    assert.equal(getDebugFlag('maybe', true), true);
  });

  it('returns defaultValue for empty string', () => {
    assert.equal(getDebugFlag('', true), true);
    assert.equal(getDebugFlag('   ', false), false);
  });

  it('defaults defaultValue to true', () => {
    assert.equal(getDebugFlag(undefined), true);
  });
});

describe('DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS', () => {
  it('is 6', () => {
    assert.equal(DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS, 6);
  });
});

describe('buildRankedScreenResponse', () => {
  it('builds a ranked response with correct shape', async () => {
    const stubClient = { getOddsHistory: async () => [] };
    const payload = {
      rows: [
        {
          playerId: 'p1',
          playerName: 'Player One',
          statType: 'points',
          line: 20.5,
          overOdds: -110,
          underOdds: -110,
          book: 'DK',
          timestamp: Date.now() - 60000
        }
      ]
    };
    const rankRows = (rows) => rows;

    const result = await buildRankedScreenResponse({
      client: stubClient,
      payloads: [payload],
      args: { debug: false, lookbackHours: 2 },
      rankRows
    });

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.result));
    assert.ok(result.freshness);
    assert.ok(result.resultMeta);
    assert.equal(result.resultMeta.lookbackHoursUsed, 2);
    assert.equal(result.resultMeta.debugEnabled, false);
  });

  it('passes recentWindowHours through to rankRows when explicitly requested', async () => {
    const payload = {
      rows: [
        {
          book: 'DK',
          timestamp: Date.now() - 60000
        }
      ]
    };
    const rankRows = (rows, options = {}) => [
      { rowCount: rows.length, recentWindowHours: options.recentWindowHours ?? null }
    ];

    const result = await buildRankedScreenResponse({
      client: null,
      payloads: [payload],
      args: { debug: true, lookbackHours: 6, recentWindowHours: 3 },
      rankRows
    });

    assert.equal(result.result[0].rowCount, 1);
    assert.equal(result.result[0].recentWindowHours, 3);
  });

  it('defaults recentWindowHours to lookbackHours when not explicitly provided', async () => {
    const payload = {
      rows: [
        {
          book: 'DK',
          timestamp: Date.now() - 60000
        }
      ]
    };
    const rankRows = (rows, options = {}) => [
      { rowCount: rows.length, recentWindowHours: options.recentWindowHours ?? null }
    ];

    const result = await buildRankedScreenResponse({
      client: null,
      payloads: [payload],
      args: { debug: false, lookbackHours: 1 },
      rankRows
    });

    assert.equal(result.result[0].rowCount, 1);
    assert.equal(result.result[0].recentWindowHours, 1);
  });
});
