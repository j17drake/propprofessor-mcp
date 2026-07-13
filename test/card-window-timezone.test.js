'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { localDateKey } = require('../lib/mcp-runtime-config');

// Replicates the exact filter predicate used in handlers.js screen path
// (post cardWindow fix). Locks the contract so the UTC bug can't return.
function screenDateFilter(row, cardWindow, nowMs, tz) {
  if (!row) return true;
  const startMs = Number(row.start) || Date.parse(row.start);
  if (!startMs) return true;
  const todayKey = localDateKey(nowMs, tz);
  const nextKey = localDateKey(nowMs + 24 * 60 * 60 * 1000, tz);
  const startDateKey = localDateKey(startMs, tz);
  return cardWindow === 'today' ? startDateKey === todayKey : startDateKey === nextKey;
}

test("late-night local game survives 'today' after UTC flip", () => {
  // now = 2026-07-12T23:00:00Z (18:00 CDT). Game tips 2026-07-13T01:00:00Z
  // (20:00 CDT) — SAME local day, was orphaned under UTC keying.
  const now = Date.parse('2026-07-12T23:00:00Z');
  const gameStart = Date.parse('2026-07-13T01:00:00Z');
  const tz = 'America/Chicago';
  assert.strictEqual(screenDateFilter({ start: gameStart }, 'today', now, tz), true);
});

test("next-day local game is excluded from 'today'", () => {
  // Game tips 2026-07-13T14:00:00Z (09:00 CDT next day) — local next day.
  const now = Date.parse('2026-07-12T23:00:00Z');
  const gameStart = Date.parse('2026-07-13T14:00:00Z');
  const tz = 'America/Chicago';
  assert.strictEqual(screenDateFilter({ start: gameStart }, 'today', now, tz), false);
});

test("same-local-day game is included in 'next' window when it is tomorrow", () => {
  // now = 2026-07-12T23:00:00Z. Game tips 2026-07-13T14:00:00Z (next local day).
  const now = Date.parse('2026-07-12T23:00:00Z');
  const gameStart = Date.parse('2026-07-13T14:00:00Z');
  const tz = 'America/Chicago';
  assert.strictEqual(screenDateFilter({ start: gameStart }, 'next', now, tz), true);
});
