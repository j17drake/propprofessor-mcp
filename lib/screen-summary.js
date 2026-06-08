'use strict';

const { americanOddsToImpliedProbability } = require('./propprofessor-shared-utils');
const { extractRowFreshnessInfo } = require('./screen-parser');

/**
 * Summarize freshness information for an array of rows.
 * Computes newest/oldest age, stale count, and timestamp source distribution.
 * @param {Array<Object>} rows - Array of row data objects.
 * @param {number} [nowMs=Date.now()] - Current time in milliseconds.
 * @param {Object} [options={}] - Options with optional maxAgeMs.
 * @param {number} [options.maxAgeMs] - Max age in ms before a row is considered stale.
 * @returns {{ rowCount: number, newestAgeMs: number|null, oldestAgeMs: number|null, staleCount: number, stale: boolean, freshnessFallbackUsed: boolean, timestampSources: Object.<string, number> }}
 */
function summarizeFreshness(rows, nowMs = Date.now(), options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const rowCount = sourceRows.length;
  const freshnessInfos = sourceRows.map(extractRowFreshnessInfo).filter((info) => info && Number.isFinite(info.ms));

  if (!freshnessInfos.length) {
    return {
      rowCount,
      newestAgeMs: rowCount ? 0 : null,
      oldestAgeMs: rowCount ? 0 : null,
      staleCount: 0,
      stale: false,
      freshnessFallbackUsed: rowCount > 0,
      timestampSources: rowCount > 0 ? { response_received: rowCount } : {}
    };
  }

  const freshnessMs = freshnessInfos.map((info) => Math.max(0, nowMs - info.ms));
  const newestAgeMs = Math.min(...freshnessMs);
  const oldestAgeMs = Math.max(...freshnessMs);
  const maxAgeMs = Number(options?.maxAgeMs);
  const staleCount =
    Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? freshnessMs.filter((age) => age > maxAgeMs).length : 0;
  const timestampSources = freshnessInfos.reduce((acc, info) => {
    acc[info.source] = (acc[info.source] || 0) + 1;
    return acc;
  }, {});

  return {
    rowCount,
    newestAgeMs,
    oldestAgeMs,
    staleCount,
    stale: staleCount > 0,
    freshnessFallbackUsed: false,
    timestampSources
  };
}

/**
 * Summarize comparison books that have available odds for a given odds key.
 * @param {Array<{ book: string, odds: Object }>} compBooks - Array of comparison book objects.
 * @param {string} oddsKey - Odds key to check (e.g. 'odds1', 'odds2').
 * @returns {{ marketBookCount: number, marketBooks: string[] }}
 */
function summarizeComparisonBooks(compBooks, oddsKey) {
  const availableBooks = compBooks.filter((item) => Number.isFinite(item?.odds?.[oddsKey]));
  return {
    marketBookCount: availableBooks.length,
    marketBooks: availableBooks.map((item) => item.book)
  };
}

/**
 * Summarize support books that have a valid implied probability for a given odds key.
 * @param {Array<{ book: string, odds: Object }>} compBooks - Array of comparison book objects.
 * @param {string} oddsKey - Odds key to check (e.g. 'odds1', 'odds2').
 * @returns {{ supportBookCount: number, supportBooks: string[] }}
 */
function summarizeSupportBooks(compBooks, oddsKey) {
  const supportBooks = compBooks.filter((item) =>
    Number.isFinite(americanOddsToImpliedProbability(item?.odds?.[oddsKey]))
  );
  return {
    supportBookCount: supportBooks.length,
    supportBooks: supportBooks.map((item) => item.book)
  };
}

/**
 * Classify the execution quality of a target book's odds against comparison book odds.
 * @param {{ targetOdds: number, comparisonOdds: number[] }} params - Target odds and comparison odds array.
 * @returns {'best'|'playable'|'bad'|'unknown'} Quality classification.
 */
function classifyExecutionQuality({ targetOdds, comparisonOdds }) {
  const finite = comparisonOdds.filter(Number.isFinite);
  if (!Number.isFinite(targetOdds) || !finite.length) return 'unknown';
  const best = Math.max(...finite);
  if (targetOdds >= best) return 'best';
  if (targetOdds >= best - 10) return 'playable';
  return 'bad';
}

module.exports = {
  classifyExecutionQuality,
  summarizeComparisonBooks,
  summarizeFreshness,
  summarizeSupportBooks
};
