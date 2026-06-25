'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Tests for Task 1: Tennis gameId → matchup string parsing
// These replicate the logic in handlers.js (~L782-794) to verify correctness.
// ---------------------------------------------------------------------------

/**
 * Extract a "player1 vs player2" string from a Tennis gameId.
 * gameId format: Tennis:PREMATCH:player1:player2:unixTimestamp
 */
function gameIdToMatchupString(gameId) {
  if (!gameId || typeof gameId !== 'string') return null;
  const parts = gameId.split(':');
  const p1 = (parts[2] || '').trim();
  const p2 = (parts[3] || '').trim();
  return (p1 && p2) ? `${p1} vs ${p2}` : null;
}

describe('gameIdToMatchupString (Tennis game context fix)', () => {
  it('parses a standard Tennis gameId into "p1 vs p2"', () => {
    const result = gameIdToMatchupString('Tennis:PREMATCH:Dimitrov:Fokina:1782388800');
    assert.equal(result, 'Dimitrov vs Fokina');
  });

  it('parses a gameId with multi-part player names (colon-free names)', () => {
    const result = gameIdToMatchupString('Tennis:PREMATCH:Halys:Humbert:1782381600');
    assert.equal(result, 'Halys vs Humbert');
  });

  it('handles WTA player names', () => {
    const result = gameIdToMatchupString('Tennis:PREMATCH:Bronzetti:Gjorcheska:1782387600');
    assert.equal(result, 'Bronzetti vs Gjorcheska');
  });

  it('handles compound-ish player names (one colon-free segment each)', () => {
    const result = gameIdToMatchupString('Tennis:PREMATCH:Andreescu:Sasnovich:1782387000');
    assert.equal(result, 'Andreescu vs Sasnovich');
  });

  it('returns null for a gameId with fewer than 5 colon-separated parts (no player2 position)', () => {
    // 3 parts: Tennis:PREMATCH:unixTimestamp
    assert.equal(gameIdToMatchupString('Tennis:PREMATCH:1782388800'), null);
  });

  it('returns null for an empty player1 or player2 segment', () => {
    // 5 parts but player1 is empty
    assert.equal(gameIdToMatchupString('Tennis:PREMATCH:::1782388800'), null);
    assert.equal(gameIdToMatchupString('Tennis:PREMATCH::Fokina:1782388800'), null);
    assert.equal(gameIdToMatchupString('Tennis:PREMATCH:Dimitrov::1782388800'), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(gameIdToMatchupString(null), null);
    assert.equal(gameIdToMatchupString(undefined), null);
  });

  it('returns null for empty string', () => {
    assert.equal(gameIdToMatchupString(''), null);
  });

  it('handles non-Tennis gameIds that happen to have 4+ colons', () => {
    // MLB gameIds have a different format — shouldn't hit this logic,
    // but the function shouldn't crash.
    const result = gameIdToMatchupString('MLB:2025-06-15:NYM:PHI:12345');
    assert.equal(result, 'NYM vs PHI');
  });
});

// ---------------------------------------------------------------------------
// Tests for Task 2: Selection-line matching disambiguation
// These replicate the numeric-extraction logic added to handlers.js
// to prevent "Over 22.5" from matching "Over 24.5".
// ---------------------------------------------------------------------------

/**
 * Extract the numeric portion from a selection string.
 * Mirrors the `selNumeric` extraction in handlers.js.
 */
function extractNumeric(sel) {
  if (!sel || typeof sel !== 'string') return null;
  const m = sel.toLowerCase().trim().match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

/**
 * Check if a stored selection should be filtered out by numeric guard.
 * When the requested selection has a number, require the stored selection
 * to include it too. Without this guard, "Over 22.5" can match "Over 24.5".
 */
function numericGuardPasses(requestedSel, storedSel) {
  const numeric = extractNumeric(requestedSel);
  if (!numeric) return true; // No numeric to guard against — pass through
  return storedSel.toLowerCase().includes(numeric);
}

describe('selection numeric disambiguation (Over/Under fix)', () => {
  it('extracts "22.5" from "Over 22.5"', () => {
    assert.equal(extractNumeric('Over 22.5'), '22.5');
  });

  it('extracts "4.5" from "Bronzetti -4.5"', () => {
    assert.equal(extractNumeric('Bronzetti -4.5'), '4.5');
  });

  it('extracts "23.5" from "under 23.5"', () => {
    assert.equal(extractNumeric('Under 23.5'), '23.5');
  });

  it('extracts "1500" from a whole-number selection', () => {
    assert.equal(extractNumeric('Points 1500'), '1500');
  });

  it('returns null when no number is present', () => {
    assert.equal(extractNumeric('Over'), null);
    assert.equal(extractNumeric('Dimitrov'), null);
    assert.equal(extractNumeric(''), null);
  });

  it('numericGuardPasses allows match when numbers match', () => {
    assert.equal(numericGuardPasses('Over 22.5', 'Over 22.5'), true);
    assert.equal(numericGuardPasses('Over 22.5', 'over 22.5'), true);
    assert.equal(numericGuardPasses('Over 22.5', 'Under 22.5'), true); // same number, OK
  });

  it('numericGuardPasses blocks match when numbers differ', () => {
    assert.equal(numericGuardPasses('Over 22.5', 'Over 24.5'), false);
    assert.equal(numericGuardPasses('Over 22.5', 'over 24.5'), false);
    assert.equal(numericGuardPasses('Under 23.5', 'Over 24.5'), false);
  });

  it('numericGuardPasses passes through when no numeric in request', () => {
    assert.equal(numericGuardPasses('Dimitrov', 'Dimitrov'), true);
    assert.equal(numericGuardPasses('Dimitrov', 'Fokina'), true);
  });

  it('numericGuardPasses: -4.5 vs -3.5 are distinguished', () => {
    assert.equal(numericGuardPasses('Bronzetti -4.5', 'Bronzetti -3.5'), false);
    assert.equal(numericGuardPasses('Bronzetti -4.5', 'Bronzetti -4.5'), true);
  });
});

// ---------------------------------------------------------------------------
// Regression: stripLine + stripOverUnder behavior that prompted the fix
// ---------------------------------------------------------------------------

/**
 * Strip trailing line digits. Mirrors the inline function in handlers.js.
 */
function stripLine(s) {
  return s.replace(/\s*[+-]?\d+(?:\.\d+)?\s*(sets|games)?\s*$/i, '').trim();
}

/**
 * Strip Over/Under prefix. Mirrors the inline function in handlers.js.
 */
function stripOverUnder(s) {
  return s.replace(/^(over|under)\s+/i, '').trim();
}

describe('stripLine + stripOverUnder regression guard', () => {
  it('stripLine removes "22.5" from "over 22.5"', () => {
    assert.equal(stripLine('over 22.5'), 'over');
  });

  it('stripLine removes "-4.5" from "bronzetti -4.5"', () => {
    assert.equal(stripLine('bronzetti -4.5'), 'bronzetti');
  });

  it('stripOverUnder removes "over " from "over 22.5"', () => {
    assert.equal(stripOverUnder('over 22.5'), '22.5');
  });

  it('stripLine + stripOverUnder both strip "over 22.5" to "over"', () => {
    // This is the ambiguous path: line 22.5 is lost
    assert.equal(stripOverUnder(stripLine('over 22.5')), 'over');
    // "Over 24.5" would also strip to "over" — hence the need for selNumeric guard
    assert.equal(stripOverUnder(stripLine('over 24.5')), 'over');
    // Prove they're indistinguishable without the numeric guard
    assert.equal(
      stripOverUnder(stripLine('over 22.5')),
      stripOverUnder(stripLine('over 24.5'))
    );
  });
});
