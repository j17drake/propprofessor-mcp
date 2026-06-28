'use strict';

const {
  normalizeMarketName,
  normalizeDirection,
  scoreRow
} = require('./propprofessor-shared-utils');

/**
 * Analyze a player prop bet query against a set of screen rows to find the best match.
 *
 * @param {Object} query - The bet query parameters.
 * @param {string} [query.player] - Player name to filter by.
 * @param {string} [query.side] - Bet side/direction (e.g. 'over', 'under'); normalized via normalizeDirection.
 * @param {number|string|null} [query.line] - The line value to match; coerced to Number.
 * @param {string} [query.market] - Market name; normalized via normalizeMarketName.
 * @param {Array<Object>} rows - Array of screen result rows to search.
 * @returns {Object} Analysis result with verdict, confidence, and matching rows.
 * @returns {string} returns.player - Normalized player name.
 * @returns {string} returns.market - Normalized market name.
 * @returns {number|null} returns.line - The requested line value.
 * @returns {string} returns.side - Normalized bet side.
 * @returns {string} returns.verdict - 'yes' if EV > 0, 'no' if EV < 0, 'pass' otherwise.
 * @returns {number} returns.confidence - Confidence score from 0-95 based on EV magnitude.
 * @returns {Object|null} returns.bestMatch - The highest-scored matching row, or null if none found.
 * @returns {Array<Object>} returns.alternatives - Up to 4 additional matching rows ranked by score.
 * @returns {Array<string>} returns.rationale - Human-readable reasoning for the verdict.
 */
function analyzePlayerPropBet(query, rows) {
  const normalizedQuery = {
    player: query.player || '',
    side: normalizeDirection(query.side),
    line: query.line !== undefined && query.line !== null ? Number(query.line) : null,
    market: normalizeMarketName(query.market)
  };

  const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const rowText = JSON.stringify(row).toLowerCase();
    const rowMarket = normalizeMarketName(row.market || row.selection || '');
    if (normalizedQuery.player && !rowText.includes(String(normalizedQuery.player).toLowerCase())) return false;
    if (normalizedQuery.market && !rowMarket.includes(normalizedQuery.market)) return false;
    return true;
  });

  const candidates = filteredRows
    .map((row) => ({ row, score: scoreRow(normalizedQuery, row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.row.ev || 0) - Number(a.row.ev || 0));

  const best = candidates[0]?.row || null;
  if (!best) {
    return {
      player: normalizedQuery.player,
      market: normalizedQuery.market,
      line: normalizedQuery.line,
      side: normalizedQuery.side,
      verdict: 'pass',
      confidence: 0,
      bestMatch: null,
      alternatives: [],
      rationale: ['No matching market found']
    };
  }

  const ev = Number(best.ev || 0);
  const verdict = ev > 0 ? 'yes' : ev < 0 ? 'no' : 'pass';
  return {
    player: normalizedQuery.player,
    market: normalizedQuery.market,
    line: normalizedQuery.line,
    side: normalizedQuery.side,
    verdict,
    confidence: Math.min(95, 50 + Math.abs(ev) * 5),
    bestMatch: best,
    alternatives: candidates.slice(1, 5).map((item) => item.row),
    rationale: [`Best match EV: ${ev}`, `Matched market: ${best.market || best.selection || 'unknown'}`]
  };
}

module.exports = { analyzePlayerPropBet };
