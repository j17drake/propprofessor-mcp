'use strict';

const {
  extractScreenRows,
  summarizeFreshness,
  getLeagueRankingPreset
} = require('./propprofessor-screen-utils');
const { hydrateScreenRowsWithHistory } = require('./propprofessor-screen-history');
const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS, getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

function normalizeBookList(books) {
  return Array.from(new Set((Array.isArray(books) ? books : [])
    .map(book => String(book || '').trim())
    .filter(Boolean)));
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

async function buildRankedScreenResponse({
  client,
  payloads = [],
  args = {},
  league,
  rankRows,
  focusBook,
  resultMeta = {}
} = {}) {
  const targetBook = String(focusBook || '').trim();
  const focusPlays = targetBook ? [{ book: targetBook }] : [];
  const rows = payloads.flatMap(payload => extractScreenRows(payload, focusPlays));
  const sharpBooks = normalizeBookList(args.historySportsbooks || args.books || (targetBook ? [targetBook] : []));
  const debug = getDebugFlag(args.debug, true);
  const lookbackHoursUsed = getLookbackHours(args);
  const hydratedRows = await hydrateScreenRowsWithHistory(rows, {
    client,
    lookbackHours: lookbackHoursUsed,
    preferredBook: targetBook || null,
    sharpBooks,
    historySportsbooks: sharpBooks
  });
  const ranked = rankRows(hydratedRows, { debug });
  const freshness = summarizeFreshness(rows, Date.now(), { maxAgeMs: getMaxAgeMs(args) });
  return {
    ok: true,
    result: ranked,
    freshness,
    resultMeta: {
      focusBook: targetBook || null,
      historySportsbooksRequested: sharpBooks,
      lookbackHoursUsed,
      debugEnabled: debug,
      freshnessFallbackUsed: freshness.freshnessFallbackUsed,
      timestampSources: freshness.timestampSources
    },
    ...resultMeta,
    ...(league ? { league } : {})
  };
}

module.exports = {
  buildRankedScreenResponse,
  getIncludeAll,
  getLeagueRankingPreset,
  getLimit,
  getLookbackHours,
  getMaxAgeMs,
  normalizeBookList,
  getDebugFlag,
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS
};
