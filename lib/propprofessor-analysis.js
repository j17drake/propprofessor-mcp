'use strict';

const {
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
  summarizeFreshness,
  parseBetPrompt,
  extractHistoryTrail
} = require('./propprofessor-screen-utils');
const {
  americanOddsToImpliedProbability,
  normalizeMarketName,
  normalizeDirection,
  scoreRow
} = require('./propprofessor-shared-utils');

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
