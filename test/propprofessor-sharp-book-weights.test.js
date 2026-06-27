'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSharpBookWeight, LEAGUE_BOOK_WEIGHTS } = require('../lib/propprofessor-sharp-book-weights');

test('Pinnacle NBA weight is 1.2', () => {
  assert.strictEqual(getSharpBookWeight('NBA', 'Pinnacle'), 1.2);
});

test('Pinnacle NFL weight is 1.4', () => {
  assert.strictEqual(getSharpBookWeight('NFL', 'Pinnacle'), 1.4);
});

test('unknown book returns 1.0', () => {
  assert.strictEqual(getSharpBookWeight('NBA', 'UnknownBook'), 1.0);
});

test('unknown league returns 1.0', () => {
  assert.strictEqual(getSharpBookWeight('Tennis', 'Pinnacle'), 1.0);
});

test('BetOnline NBA weight is 0.8 (less predictive)', () => {
  assert.strictEqual(getSharpBookWeight('NBA', 'BetOnline'), 0.8);
});

test('weights object is structured correctly', () => {
  assert.ok(typeof LEAGUE_BOOK_WEIGHTS, 'object');
  assert.ok(typeof LEAGUE_BOOK_WEIGHTS.NBA, 'object');
  assert.ok(typeof LEAGUE_BOOK_WEIGHTS.MLB, 'object');
  assert.ok(typeof LEAGUE_BOOK_WEIGHTS.NFL, 'object');
  assert.ok(typeof LEAGUE_BOOK_WEIGHTS.NHL, 'object');
});
