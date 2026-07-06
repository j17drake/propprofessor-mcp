'use strict';

/**
 * Filter ranked rows by kaiCall / displayTier.
 *
 * The data has two parallel fields that mean the same thing:
 *   - kaiCall:  raw signal-quality label (BET | CONSIDER | PASS)
 *   - displayTier: same label, derived from kaiCall for downstream tools
 *
 * Agents want to filter to "Bets only" or "Bets + Considers, no Passes."
 * This module gives them that without re-implementing the field mapping
 * in every handler.
 */

const VALID_TIERS = new Set(['BET', 'CONSIDER', 'PASS']);

/**
 * Normalize an array of kaiCall/displayTier filter values to a Set of
 * uppercase strings. Drops invalid entries silently (we don't want a typo
 * to silently drop the request — but we also don't want it to crash).
 *
 * @param {string[]|string|undefined|null} filter
 * @returns {Set<string>|null} Set of allowed tiers, or null if filter is empty/missing
 */
function normalizeKaiCallFilter(filter) {
  if (filter === null || filter === undefined) return null;
  const arr = Array.isArray(filter) ? filter : [filter];
  if (arr.length === 0) return null;
  const out = new Set();
  for (const raw of arr) {
    if (raw === null || raw === undefined) continue;
    const upper = String(raw).trim().toUpperCase();
    if (VALID_TIERS.has(upper)) out.add(upper);
  }
  return out.size > 0 ? out : null;
}

/**
 * Resolve a row's kaiCall value to its canonical tier string.
 * Falls back to displayTier if kaiCall is missing, then to 'PASS'.
 *
 * @param {Object} [row]
 * @returns {string} BET | CONSIDER | PASS
 */
function rowKaiCall(row) {
  if (!row || typeof row !== 'object') return 'PASS';
  const raw = row.kaiCall ?? row.displayTier ?? null;
  if (raw === null || raw === undefined) return 'PASS';
  const upper = String(raw).trim().toUpperCase();
  return VALID_TIERS.has(upper) ? upper : 'PASS';
}

/**
 * Filter an array of rows by kaiCall. Returns input unchanged if filter
 * is empty/missing (backward compat: "no filter" = "all rows").
 *
 * @param {Object[]} rows
 * @param {string[]|string|undefined} kaiCall
 * @returns {Object[]}
 */
function filterRowsByKaiCall(rows, kaiCall) {
  if (!Array.isArray(rows)) return rows;
  const allowed = normalizeKaiCallFilter(kaiCall);
  if (!allowed) return rows;
  return rows.filter((row) => allowed.has(rowKaiCall(row)));
}

/**
 * Filter rows by minimum expected value (consensusEdge).
 * Rows with consensusEdge >= minEV are kept. Rows with null/missing edge are dropped.
 *
 * @param {Object[]} rows
 * @param {number|undefined|null} minEV - Minimum consensus edge percentage (e.g. 1.5 = 1.5%)
 * @returns {Object[]}
 */
function filterRowsByMinEV(rows, minEV) {
  if (!Array.isArray(rows)) return rows;
  if (minEV === null || minEV === undefined || typeof minEV !== 'number') return rows;
  return rows.filter((row) => {
    const edge = Number(row.consensusEdge ?? row.edge ?? null);
    return Number.isFinite(edge) && edge >= minEV;
  });
}

module.exports = {
  filterRowsByKaiCall,
  filterRowsByMinEV,
  normalizeKaiCallFilter,
  rowKaiCall,
  VALID_TIERS
};
