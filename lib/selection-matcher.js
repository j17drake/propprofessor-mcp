'use strict';

/**
 * Find the best matching row from detail rows for a requested selection.
 *
 * Priority order (highest first):
 *   1. playId exact match (when requestedPlayId provided)
 *   2. Exact selection match (with numeric guard)
 *   3. Stripped line match (remove trailing "-1.5", "+110", etc.)
 *   4. Stripped Over/Under match (remove "Over "/"Under " prefix)
 *   5. Nested selection objects (r.selections)
 *   6. Home/away team includes (last resort)
 *
 * NUMERIC GUARD: When the user's selection contains a number (e.g. "22.5"
 * in "Over 22.5"), rows whose selection field STILL contains that number
 * after stripping get priority. This prevents "Over 22.5" from matching a
 * row with selection "Over 24.5" when both exist in the same market.
 *
 * @param {Object[]} detailRows - Screen detail rows
 * @param {string} selection - Requested selection string
 * @param {string} [requestedPlayId] - Optional playId for exact match
 * @returns {Object|null} Best matching row or null
 */
function findBestMatch(detailRows = [], selection = '', requestedPlayId = '') {
  if (!Array.isArray(detailRows) || !detailRows.length || !selection) return null;

  const selLower = normalizeKey(selection);
  const selNumeric = extractNumeric(selLower);
  const selStrippedLine = stripLine(selLower);
  const selStrippedOU = stripOverUnder(selLower);
  const selStrippedBoth = stripOverUnder(selStrippedLine);

  /** Check if a stored selection passes the numeric guard */
  function passesNumericGuard(stored) {
    if (!selNumeric) return true; // no number in request → no guard
    return stored.includes(selNumeric);
  }

  // Pass 1: playId exact match
  if (requestedPlayId) {
    const match = detailRows.find((r) => String(r.playId || '').trim() === requestedPlayId);
    if (match) return match;
  }

  // Pass 2: exact selection match
  const exact = detailRows.find((r) => {
    const stored = normalizeKey(r.selection || r.participant || '');
    if (stored === selLower) return passesNumericGuard(stored);
    return false;
  });
  if (exact) return exact;

  // Pass 3: stripped line match — strip BOTH sides
  const stripped = detailRows.find((r) => {
    const stored = normalizeKey(r.selection || r.participant || '');
    const storedStripped = stripLine(stored);
    if (!passesNumericGuard(stored)) return false;
    return storedStripped === selStrippedLine;
  });
  if (stripped) return stripped;

  // Pass 4: stripped Over/Under match — strip BOTH sides
  const ouMatch = detailRows.find((r) => {
    const stored = normalizeKey(r.selection || r.participant || '');
    const storedStrippedOU = stripOverUnder(stored);
    if (!passesNumericGuard(stored)) return false;
    return storedStrippedOU === selStrippedOU || storedStrippedOU === selStrippedBoth;
  });
  if (ouMatch) return ouMatch;

  // Pass 5: nested selection objects (r.selections)
  const nested = detailRows.find((r) => {
    if (!r.selections || typeof r.selections !== 'object') return false;
    for (const key of Object.keys(r.selections)) {
      const sel = r.selections[key];
      if (!sel || typeof sel !== 'object') continue;
      const s1 = normalizeKey(sel.selection1 || '');
      const s2 = normalizeKey(sel.selection2 || '');
      if (s1 === selLower || s2 === selLower) return true;
      if (!passesNumericGuard(s1) && !passesNumericGuard(s2)) continue;
      if (s1 === selStrippedLine || s2 === selStrippedLine) return true;
      if (s1 === selStrippedOU || s2 === selStrippedOU) return true;
    }
    return false;
  });
  if (nested) return nested;

  // Pass 6: home/away team includes (last resort — most lossy)
  return (
    detailRows.find((r) => {
      const home = normalizeKey(r.homeTeam || '');
      const away = normalizeKey(r.awayTeam || '');
      return home.includes(selLower) || away.includes(selLower);
    }) || null
  );
}

/** Normalize a key for comparison */
function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Strip trailing line/spread: "Harris -1.5" → "Harris", "Over 22.5" → "Over" */
function stripLine(s) {
  return s.replace(/\s*[+-]?\d+(?:\.\d+)?\s*(sets|games)?\s*$/i, '').trim();
}

/** Strip "Over "/"Under " prefix */
function stripOverUnder(s) {
  return s.replace(/^(over|under)\s+/i, '').trim();
}

/** Extract the first numeric portion from a string */
function extractNumeric(s) {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

module.exports = { findBestMatch, normalizeKey, stripLine, stripOverUnder, extractNumeric };
