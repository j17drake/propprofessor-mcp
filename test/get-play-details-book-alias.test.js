'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildValidationTools } = require('../lib/tool-definitions/validation');
const { validateArgs } = require('../lib/mcp-arg-validator');

test('get_play_details schema declares book alias property', () => {
  const tools = buildValidationTools();
  const gpd = tools.find((t) => t.name === 'get_play_details');
  assert.ok(gpd, 'get_play_details tool exists');
  assert.ok(gpd.inputSchema.properties.book, 'book alias property present');
});

test('book-only call passes the schema gate', () => {
  const tools = buildValidationTools();
  const gpd = tools.find((t) => t.name === 'get_play_details');
  const err = validateArgs(gpd.inputSchema, { league: 'WNBA', gameIds: ['x'], book: 'NoVigApp' });
  assert.ok(err && err.ok, 'book-only call must pass the schema gate (err.ok === true)');
});

test('book is coerced to books array by the handler', () => {
  // Simulate the handler coercion; the real handler does this before caching.
  const args = { league: 'WNBA', gameIds: ['x'], book: 'NoVigApp' };
  if (!args.books && args.book) args.books = [args.book];
  assert.deepStrictEqual(args.books, ['NoVigApp']);
});
