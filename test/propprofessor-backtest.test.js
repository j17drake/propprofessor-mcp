'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { backtest, parseArgs, resolveOutcome } = require('../scripts/backtest');

describe('backtest CLI', () => {
  describe('parseArgs', () => {
    it('returns defaults when no arguments provided', () => {
      const opts = parseArgs(['node', 'backtest.js']);
      assert.equal(opts.league, 'MLB');
      assert.equal(opts.market, 'Moneyline');
      assert.equal(opts.days, 30);
    });

    it('parses positional arguments', () => {
      const opts = parseArgs(['node', 'backtest.js', 'NBA', 'Spread', '7']);
      assert.equal(opts.league, 'NBA');
      assert.equal(opts.market, 'Spread');
      assert.equal(opts.days, 7);
    });

    it('falls back to defaults for missing positionals', () => {
      const opts = parseArgs(['node', 'backtest.js', 'Tennis']);
      assert.equal(opts.league, 'Tennis');
      assert.equal(opts.market, 'Moneyline');
      assert.equal(opts.days, 30);
    });
  });

  describe('resolveOutcome', () => {
    it('returns null for non-object input', () => {
      assert.equal(resolveOutcome(null), null);
      assert.equal(resolveOutcome(undefined), null);
    });

    it('recognizes win variants', () => {
      assert.equal(resolveOutcome({ outcome: 'win' }), 'win');
      assert.equal(resolveOutcome({ outcome: 'won' }), 'win');
      assert.equal(resolveOutcome({ outcome: 'W' }), 'win');
      assert.equal(resolveOutcome({ outcome: 'green' }), 'win');
    });

    it('recognizes loss variants', () => {
      assert.equal(resolveOutcome({ outcome: 'loss' }), 'loss');
      assert.equal(resolveOutcome({ outcome: 'lost' }), 'loss');
      assert.equal(resolveOutcome({ outcome: 'L' }), 'loss');
      assert.equal(resolveOutcome({ outcome: 'red' }), 'loss');
    });

    it('recognizes push variants', () => {
      assert.equal(resolveOutcome({ outcome: 'push' }), 'push');
      assert.equal(resolveOutcome({ outcome: 'tie' }), 'push');
      assert.equal(resolveOutcome({ outcome: 'no_decision' }), 'push');
      assert.equal(resolveOutcome({ outcome: 'void' }), 'push');
    });

    it('falls back to result and settled fields', () => {
      assert.equal(resolveOutcome({ result: 'win' }), 'win');
      assert.equal(resolveOutcome({ settled: 'loss' }), 'loss');
    });

    it('returns null when no outcome field present', () => {
      assert.equal(resolveOutcome({ odds: -110 }), null);
    });

    it('returns null for unrecognized values', () => {
      assert.equal(resolveOutcome({ outcome: 'pending' }), null);
      assert.equal(resolveOutcome({ outcome: 'in_progress' }), null);
    });
  });

  describe('backtest function', () => {
    it('is exported and is a function', () => {
      assert.equal(typeof backtest, 'function');
    });

    it('returns an object with an ok field', async () => {
      // This will fail to connect (no auth), but should still return a result
      // object rather than throwing.
      const result = await backtest({ league: 'NONEXISTENT_LEAGUE_999', market: 'Moneyline', days: 1 });
      assert.equal(typeof result, 'object');
      assert.ok('ok' in result, 'result must have an ok field');
    });
  });
});
