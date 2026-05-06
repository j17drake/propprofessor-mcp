'use strict';

const {
  normalizeMarketName,
  normalizeDirection,
  parseBetPrompt,
  americanOddsToImpliedProbability,
  extractHistoryTrail,
  extractScreenRows,
  isTennisRow,
  normalizeLeagueName,
  normalizeTennisMarketQuery,
  rankScreenRows,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate,
  summarizeFreshness
} = require('./propprofessor-screen-utils');

function scoreRow(query, row) {
  const text = JSON.stringify(row).toLowerCase();
  const marketText = normalizeMarketName(row.market || row.selection || '');
  let score = 0;
  if (query.player && text.includes(String(query.player).toLowerCase())) score += 4;
  if (query.market && marketText.includes(query.market)) score += 2;
  if (query.side && text.includes(normalizeDirection(query.side))) score += 1;
  if (query.line !== undefined && query.line !== null && text.includes(String(query.line))) score += 1;
  return score;
}

function extractFreshnessTimestampMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractRowFreshnessMs(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [
    row.updatedAt,
    row.lastUpdated,
    row.lastUpdate,
    row.timestamp,
    row.time,
    row.createdAt,
    row.pulledAt,
    row.refreshedAt,
    row.asOf,
    row.scrapedAt,
    row.fetchedAt,
    row.snapshotAt,
    row.payload?.updatedAt,
    row.payload?.lastUpdated,
    row.meta?.updatedAt,
    row.meta?.timestamp
  ];
  for (const candidate of candidates) {
    const ms = extractFreshnessTimestampMs(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}


function analyzePlayerPropBet(query, rows) {
  const normalizedQuery = {
    player: query.player || '',
    side: normalizeDirection(query.side),
    line: query.line !== undefined && query.line !== null ? Number(query.line) : null,
    market: normalizeMarketName(query.market)
  };

  const filteredRows = (Array.isArray(rows) ? rows : []).filter(row => {
    const rowText = JSON.stringify(row).toLowerCase();
    const rowMarket = normalizeMarketName(row.market || row.selection || '');
    if (normalizedQuery.player && !rowText.includes(String(normalizedQuery.player).toLowerCase())) return false;
    if (normalizedQuery.market && !rowMarket.includes(normalizedQuery.market)) return false;
    return true;
  });

  const candidates = filteredRows
    .map(row => ({ row, score: scoreRow(normalizedQuery, row) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (Number(b.row.ev || 0) - Number(a.row.ev || 0)));

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
    alternatives: candidates.slice(1, 5).map(item => item.row),
    rationale: [
      `Best match EV: ${ev}`,
      `Matched market: ${best.market || best.selection || 'unknown'}`
    ]
  };
}

module.exports = {
  analyzePlayerPropBet,
  normalizeMarketName,
  normalizeDirection,
  parseBetPrompt,
  americanOddsToImpliedProbability,
  extractHistoryTrail,
  extractScreenRows,
  isTennisRow,
  normalizeLeagueName,
  normalizeTennisMarketQuery,
  rankScreenRows,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate,
  summarizeFreshness
};
