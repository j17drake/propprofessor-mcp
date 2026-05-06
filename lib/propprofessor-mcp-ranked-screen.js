'use strict';

const {
  extractScreenRows,
  summarizeFreshness,
  getLeagueRankingPreset
} = require('./propprofessor-screen-utils');
const { hydrateScreenRowsWithHistory } = require('./propprofessor-screen-history');

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
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
  const hydratedRows = await hydrateScreenRowsWithHistory(rows, {
    client,
    lookbackHours: getLookbackHours(args),
    preferredBook: targetBook || null,
    sharpBooks,
    historySportsbooks: sharpBooks
  });
  const ranked = rankRows(hydratedRows);
  return {
    ok: true,
    result: ranked,
    freshness: summarizeFreshness(rows),
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
  normalizeBookList
};
