'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { localDateKey } = require('../lib/mcp-runtime-config');

test('UTC-late timestamp maps to same local calendar day in Chicago', () => {
  // 2026-07-12T23:30:00Z = 18:30 CDT (America/Chicago, UTC-5) — same local day.
  const ms = Date.parse('2026-07-12T23:30:00Z');
  assert.strictEqual(localDateKey(ms, 'America/Chicago'), '2026-07-12');
});

test('UTC-midnight-plus maps to next local day only after local midnight', () => {
  // 2026-07-13T05:30:00Z = 00:30 CDT — now it IS the next local day.
  const ms = Date.parse('2026-07-13T05:30:00Z');
  assert.strictEqual(localDateKey(ms, 'America/Chicago'), '2026-07-13');
});

test('falls back to null on invalid input', () => {
  assert.strictEqual(localDateKey(NaN, 'America/Chicago'), null);
  assert.strictEqual(localDateKey(undefined, 'America/Chicago'), null);
});

test('defaults to getLocalTimezone when tz omitted', () => {
  const ms = Date.parse('2026-07-12T23:30:00Z');
  // Without LOCAL_TIMEZONE override the default is America/Chicago.
  assert.strictEqual(localDateKey(ms), '2026-07-12');
});
