'use strict';

const { normalizeSelectionId } = require('./propprofessor-api');
const { resolveHistoryForEntity } = require('./propprofessor-history');
const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

function buildRowCacheKey(row = {}) {
  const gameId = row.gameId ?? row.game_id ?? row.gameID ?? row.game?.id ?? null;
  const selectionId = normalizeSelectionId(row.selectionId ?? row.selection_id ?? row.selectionID ?? row.selection);
  if (gameId && selectionId) {
    return `${gameId}::${selectionId}`;
  }
  const book = String(row.book || row.sportsbook || '').trim();
  const pick = String(row.pick || row.selection || row.participant || '').trim();
  const game = String(row.game || row.matchup || '').trim();
  const odds = String(row.odds ?? row.currentOdds ?? '').trim();
  return `${book}::${pick}::${game}::${odds}`;
}

/**
 * Hydrate screen rows with odds history data. For each row, resolves line history
 * from the odds history API (or preserves inline lineHistory if already present).
 * Rows are processed concurrently with a configurable concurrency limit.
 *
 * @param {Array<object>} rows - Array of screen row objects to hydrate with history.
 * @param {object}        [options] - Optional configuration object.
 * @param {object}        options.client - API client that exposes a queryOddsHistory method.
 * @param {number}        [options.lookbackHours] - Hours to look back when fetching odds history.
 *                                                   Falls back to getOddsHistoryLookbackHours().
 * @param {string[]}      [options.historySportsbooks=[]] - Sportsbook names to include in history queries.
 * @param {string|null}   [options.preferredBook=null] - Preferred execution book name.
 * @param {string[]}      [options.sharpBooks=[]] - Sharp book names used for movement comparison.
 * @param {number}        [options.concurrency=6] - Max number of concurrent history resolutions.
 * @returns {Promise<Array<object>>} The input rows hydrated with lineHistory, lineHistoryAvailable,
 *                                    lineHistorySource, lineHistoryLookbackHours, and related
 *                                    metadata fields (normalizedSelectionId, historyGameId,
 *                                    historyMatchedBy, historyMatchKey, historySportsbooksRequested).
 */
async function hydrateScreenRowsWithHistory(
  rows,
  {
    client,
    lookbackHours = getOddsHistoryLookbackHours(),
    historySportsbooks = [],
    preferredBook = null,
    sharpBooks = [],
    concurrency = 6
  } = {}
) {
  const sourceRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  if (!sourceRows.length || !client || typeof client.queryOddsHistory !== 'function') {
    return sourceRows;
  }

  const cache = new Map();

  async function resolveRow(row) {
    if (Array.isArray(row.lineHistory) && row.lineHistory.length >= 2) {
      return {
        ...row,
        lineHistoryAvailable: true,
        lineHistorySource: row.lineHistorySource || 'screen_payload',
        lineHistoryLookbackHours: Number.isFinite(Number(row.lineHistoryLookbackHours))
          ? Number(row.lineHistoryLookbackHours)
          : lookbackHours,
        normalizedSelectionId: row.normalizedSelectionId || null,
        historyGameId: row.historyGameId || null,
        historyMatchedBy: row.historyMatchedBy || null,
        historyMatchKey: row.historyMatchKey || null
      };
    }

    const cacheKey = buildRowCacheKey(row);
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        resolveHistoryForEntity({
          client,
          target: row,
          rows: sourceRows,
          lookbackHours,
          historySportsbooks,
          preferredBook,
          sharpBooks,
          queryHistoryFn: (params) => client.queryOddsHistory(params)
        }).catch((error) => {
          process.stderr.write(`[propprofessor-mcp] History resolution failed: ${error?.message || error}\n`);
          return {
            lineHistory: [],
            lineHistoryAvailable: false,
            lineHistorySource: null,
            historyError: error?.message || String(error)
          };
        })
      );
    }

    const resolved = await cache.get(cacheKey);
    if (resolved?.lineHistoryAvailable) {
      return {
        ...row,
        lineHistory: resolved.lineHistory,
        lineHistoryAvailable: true,
        lineHistorySource: resolved.lineHistorySource || 'odds_history',
        lineHistoryLookbackHours: lookbackHours,
        normalizedSelectionId: resolved.normalizedSelectionId || null,
        historyGameId: resolved.historyGameId || null,
        historyMatchedBy: resolved.historyMatchedBy || null,
        historyMatchKey: resolved.historyMatchKey || null,
        historySportsbooksRequested: Array.isArray(resolved.historySportsbooksRequested)
          ? resolved.historySportsbooksRequested
          : []
      };
    }

    return {
      ...row,
      lineHistory: Array.isArray(row.lineHistory) ? row.lineHistory : [],
      lineHistoryAvailable: false,
      lineHistorySource: row.lineHistorySource || null,
      lineHistoryLookbackHours: Number.isFinite(Number(row.lineHistoryLookbackHours))
        ? Number(row.lineHistoryLookbackHours)
        : lookbackHours
    };
  }

  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(sourceRows.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < sourceRows.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await resolveRow(sourceRows[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, sourceRows.length) }, () => runWorker()));
  return results;
}

module.exports = {
  hydrateScreenRowsWithHistory
};
