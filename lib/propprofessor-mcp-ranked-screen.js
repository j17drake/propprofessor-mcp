'use strict';

const { extractScreenRows, summarizeFreshness, getLeagueRankingPreset } = require('./propprofessor-screen-utils');
const { hydrateScreenRowsWithHistory } = require('./propprofessor-screen-history');
const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS, getOddsHistoryLookbackHours } = require('./mcp-runtime-config');
const { uniqueBooks } = require('./propprofessor-sharp-books');

function normalizeBookList(books) {
  return uniqueBooks(books);
}

function getLimit(args = {}) {
  const limit = Number(args.limit);
  return Number.isFinite(limit) && limit > 0 ? limit : 10;
}

function getIncludeAll(args = {}) {
  return args.includeAll !== undefined ? Boolean(args.includeAll) : true;
}

function getMaxAgeMs(args = {}) {
  const value = Number(args.maxAgeMs);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getLookbackHours(args = {}) {
  const value = Number(args.lookbackHours);
  return Number.isFinite(value) && value > 0 ? value : getOddsHistoryLookbackHours();
}

function getRecentWindowHours(args = {}) {
  const value = Number(args.recentWindowHours);
  return Number.isFinite(value) && value > 0 ? value : getLookbackHours(args);
}

function getDebugFlag(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  return defaultValue;
}

function getCompactFlag(args = {}) {
  if (args.compact === undefined || args.compact === null) return false;
  if (typeof args.compact === 'boolean') return args.compact;
  const normalized = String(args.compact).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

// Default field set used when compact=true
const COMPACT_FIELDS = [
  'id', 'gameId', 'start', 'league', 'homeTeam', 'awayTeam', 'isLive',
  'market', 'participant', 'selection', 'pick', 'odds', 'currentOdds',
  'line', 'edge', 'clv', 'clvProxyPct', 'consensusBookCount',
  'executionQuality', 'movementGrade', 'riskScore', 'kaiCall',
  'confidenceTier', 'rationale', 'screenScore', 'adaptiveConfidence',
  'suppressed', 'suppressedBy', 'book', 'playType',
  'lineHistoryAvailable', 'lineHistoryPoints'
];

/**
 * Filter a row to only the specified fields.
 * @param {Object} row - Full ranked row
 * @param {string[]} fields - Field names to keep
 * @returns {Object} Row with only the requested fields
 */
function filterRowFields(row = {}, fields = []) {
  if (!Array.isArray(fields) || !fields.length) return row;
  const result = {};
  for (const field of fields) {
    if (field in row) {
      result[field] = row[field];
    }
  }
  return result;
}

/**
 * Strip a ranked row down to essential fields only.
 * Removes: lineHistory, scoreBreakdown, selections (full odds map),
 *          movement debug payloads, and other verbose metadata.
 * Keeps: game, selection, odds, edge, tier, kai, start, risk, etc.
 */
function compactRow(row = {}) {
  return filterRowFields(row, COMPACT_FIELDS);
}

function compactResult(ranked = []) {
  return ranked.map(compactRow);
}

/**
 * Analyze ranked rows and emit warnings when the response is operating in degraded mode.
 * Prevents users from treating weak signals as strong ones.
 */
function buildDegradedDataWarnings(ranked, rows, freshness) {
  const warnings = [];
  if (!ranked || ranked.length === 0) return warnings;

  const totalRows = ranked.length;

  // Line history availability
  const rowsWithHistory = ranked.filter(
    (r) => Array.isArray(r.lineHistory) && r.lineHistory.length > 0
  ).length;
  const historyPct = Math.round((rowsWithHistory / totalRows) * 100);
  if (rowsWithHistory === 0) {
    warnings.push(
      `No line history available for any of ${totalRows} rows. Movement scores and CLV tracking are unavailable.`
    );
  } else if (historyPct < 50) {
    warnings.push(
      `Line history available for only ${rowsWithHistory}/${totalRows} rows (${historyPct}%). Movement analysis is limited.`
    );
  }

  // Consensus book coverage
  const rowsWithConsensus = ranked.filter(
    (r) => Number(r.consensusBookCount || 0) >= 2
  ).length;
  if (rowsWithConsensus === 0) {
    warnings.push(
      `No consensus data: all ${totalRows} rows show only single-book odds. Cross-book validation is unavailable.`
    );
  } else if (rowsWithConsensus < totalRows * 0.5) {
    warnings.push(
      `Consensus data sparse: only ${rowsWithConsensus}/${totalRows} rows have 2+ books posting. Most plays lack cross-book validation.`
    );
  }

  // Freshness fallback
  if (freshness && freshness.freshnessFallbackUsed) {
    warnings.push(
      `Data freshness is estimated (fallback mode). Actual timestamps were unavailable.`
    );
  }

  // Movement scores all zero
  const rowsWithMovement = ranked.filter(
    (r) => {
      const breakdown = r.scoreBreakdown;
      return breakdown && (Number(breakdown.movementScore || 0) > 0 || Number(breakdown.consensusScore || 0) > 0);
    }
  ).length;
  if (rowsWithMovement === 0 && rowsWithHistory === 0) {
    warnings.push(
      `All ranking scores driven by sport score alone. Movement and consensus scores are zero due to missing history data.`
    );
  }

  return warnings;
}

async function buildRankedScreenResponse({
  client,
  payloads = [],
  args = {},
  league,
  rankRows,
  focusBook,
  resultMeta = {}
} = {}) {
  const compact = getCompactFlag(args);
  const targetBook = String(focusBook || '').trim();
  const focusPlays = targetBook ? [{ book: targetBook }] : [];
  const rows = payloads.flatMap((payload) => extractScreenRows(payload, focusPlays));
  const sharpBooks = normalizeBookList(args.historySportsbooks || args.books || (targetBook ? [targetBook] : []));
  const debug = getDebugFlag(args.debug, true);
  const lookbackHoursUsed = getLookbackHours(args);
  const recentWindowHours = getRecentWindowHours(args);

  // When compact=true, skip history hydration entirely — avoids N+1 API calls
  // that would just be stripped from the response anyway.
  const hydratedRows = compact
    ? rows
    : await hydrateScreenRowsWithHistory(rows, {
        client,
        lookbackHours: lookbackHoursUsed,
        preferredBook: targetBook || null,
        sharpBooks,
        historySportsbooks: sharpBooks
      });

  const ranked = rankRows(hydratedRows, { debug, recentWindowHours });
  const freshness = summarizeFreshness(rows, Date.now(), { maxAgeMs: getMaxAgeMs(args) });
  const warnings = buildDegradedDataWarnings(ranked, rows, freshness);
  const fields = Array.isArray(args.fields) && args.fields.length
    ? args.fields.map(f => String(f).trim()).filter(Boolean)
    : null;

  // Determine the result rows: fields > compact > full
  let resultRows;
  if (fields) {
    resultRows = ranked.map(row => filterRowFields(row, fields));
  } else if (compact) {
    resultRows = compactResult(ranked);
  } else {
    resultRows = ranked;
  }

  // Build the base response
  const includeList = Array.isArray(args.include) && args.include.length
    ? args.include.map(s => String(s).trim().toLowerCase()).filter(Boolean)
    : null;

  const baseResponse = {
    ok: true,
    result: resultRows,
    freshness,
    ...(warnings.length > 0 ? { warnings } : {}),
    resultMeta: {
      focusBook: targetBook || null,
      historySportsbooksRequested: sharpBooks,
      lookbackHoursUsed,
      debugEnabled: debug,
      freshnessFallbackUsed: freshness.freshnessFallbackUsed,
      timestampSources: freshness.timestampSources,
      degradedDataWarningCount: warnings.length,
      compact,
      fields: fields || (compact ? COMPACT_FIELDS : null)
    },
    ...resultMeta,
    ...(league ? { league } : {})
  };

  // When include is specified, filter top-level keys
  if (includeList) {
    const allowed = new Set(['ok', 'result', ...includeList]);
    const filtered = {};
    for (const key of Object.keys(baseResponse)) {
      if (allowed.has(key)) {
        filtered[key] = baseResponse[key];
      }
    }
    return filtered;
  }

  return baseResponse;
}

module.exports = {
  buildRankedScreenResponse,
  buildDegradedDataWarnings,
  getIncludeAll,
  getLeagueRankingPreset,
  getLimit,
  getLookbackHours,
  getRecentWindowHours,
  getMaxAgeMs,
  normalizeBookList,
  getDebugFlag,
  getCompactFlag,
  compactRow,
  compactResult,
  filterRowFields,
  COMPACT_FIELDS,
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS
};
