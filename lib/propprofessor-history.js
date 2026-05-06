'use strict';

const { normalizeSelectionId } = require('./propprofessor-api');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeHistoryPoint(point) {
  if (point === null || point === undefined) return null;
  if (typeof point !== 'object') {
    const odds = Number(point);
    return { line: null, odds: Number.isFinite(odds) ? odds : null, raw: point };
  }

  const lineCandidates = [point.line, point.value, point.total, point.handicap, point.priceLine, point.spread];
  const oddsCandidates = [point.odds, point.price, point.americanOdds, point.currentOdds, point.current, point.open, point.close];
  const line = lineCandidates.map(Number).find(Number.isFinite);
  const odds = oddsCandidates.map(Number).find(Number.isFinite);

  return {
    line: Number.isFinite(line) ? line : null,
    odds: Number.isFinite(odds) ? odds : null,
    book: point.book || point.sportsbook || point.site || '',
    time: point.time || point.timestamp || point.updatedAt || point.start_ts || point.end_ts || null,
    liquidity: point.liquidity ?? point.volume ?? null,
    raw: point
  };
}

function normalizeHistoryPayload(payload) {
  const candidates = [];
  if (Array.isArray(payload)) candidates.push(payload);
  if (Array.isArray(payload?.data)) candidates.push(payload.data);
  if (Array.isArray(payload?.result)) candidates.push(payload.result);
  if (Array.isArray(payload?.results)) candidates.push(payload.results);
  if (Array.isArray(payload?.history)) candidates.push(payload.history);
  if (Array.isArray(payload?.oddsHistory)) candidates.push(payload.oddsHistory);

  for (const candidate of candidates) {
    const points = candidate.map(normalizeHistoryPoint).filter(Boolean);
    if (points.length >= 2) return points;
  }

  if (payload && typeof payload === 'object') {
    const bookPoints = [];
    for (const [book, entries] of Object.entries(payload)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const point = normalizeHistoryPoint({ ...entry, book: entry?.book || book });
        if (point) bookPoints.push(point);
      }
    }
    if (bookPoints.length >= 2) return bookPoints;
  }

  return [];
}

function scoreHistoryRow(target = {}, row = {}) {
  let score = 0;
  const fields = [
    ['book', ['book', 'sportsbook', 'fantasyApp', 'site']],
    ['playType', ['playType', 'betType', 'market', 'selectionType']],
    ['pick', ['pick', 'selection', 'participant', 'name', 'label', 'title']],
    ['game', ['game', 'matchup', 'event', 'fixture', 'competition']],
    ['odds', ['odds', 'price', 'americanOdds', 'currentOdds']],
    ['league', ['league', 'sport']]
  ];

  for (const [targetKey, rowKeys] of fields) {
    const targetValue = normalizeText(target[targetKey]);
    if (!targetValue) continue;
    for (const key of rowKeys) {
      const rowValue = normalizeText(row[key]);
      if (!rowValue) continue;
      if (rowValue === targetValue) {
        score += key === 'book' ? 5 : key === 'pick' ? 4 : key === 'game' ? 3 : key === 'playType' ? 2 : 1;
        break;
      }
      if (rowValue.includes(targetValue) || targetValue.includes(rowValue)) {
        score += key === 'book' ? 4 : key === 'pick' ? 3 : key === 'game' ? 2 : 1;
        break;
      }
    }
  }

  const rowOdds = Number(row.odds ?? row.price ?? row.americanOdds ?? row.currentOdds);
  const targetOdds = Number(target.odds);
  if (Number.isFinite(rowOdds) && Number.isFinite(targetOdds) && rowOdds === targetOdds) score += 2;

  if (target.selectionId && row.selectionId && normalizeSelectionId(row.selectionId) === normalizeSelectionId(target.selectionId)) score += 10;
  if (target.gameId && row.gameId && String(row.gameId) === String(target.gameId)) score += 10;

  return score;
}

function valuesMatch(a, b, { allowPartial = true } = {}) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return allowPartial && (left.includes(right) || right.includes(left));
}

function getRowValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function getOddsHistoryStartTimestamp({ lookbackHours = 12, nowMs = Date.now() } = {}) {
  const hours = Number(lookbackHours);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 12;
  const now = Number(nowMs);
  const safeNowMs = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, Math.floor(safeNowMs / 1000) - Math.floor(safeHours * 60 * 60));
}

function getMatchStrength(target = {}, row = {}) {
  const selectionIdMatch = Boolean(target.selectionId && row.selectionId && normalizeSelectionId(row.selectionId) === normalizeSelectionId(target.selectionId));
  const gameIdMatch = Boolean(target.gameId && row.gameId && String(row.gameId) === String(target.gameId));
  const bookMatch = valuesMatch(target.book, getRowValue(row, ['book', 'sportsbook', 'fantasyApp', 'site']), { allowPartial: false });
  const pickMatch = valuesMatch(target.pick, getRowValue(row, ['pick', 'selection', 'participant', 'name', 'label', 'title']));
  const gameMatch = valuesMatch(target.game, getRowValue(row, ['game', 'matchup', 'event', 'fixture', 'competition']));
  const rowOdds = Number(row.odds ?? row.price ?? row.americanOdds ?? row.currentOdds);
  const targetOdds = Number(target.odds);
  const oddsMatch = Number.isFinite(rowOdds) && Number.isFinite(targetOdds) && rowOdds === targetOdds;
  const directIdMatch = selectionIdMatch || gameIdMatch;
  const fallbackStrong = bookMatch && pickMatch && (gameMatch || oddsMatch);
  return {
    strong: directIdMatch || fallbackStrong,
    directIdMatch,
    selectionIdMatch,
    gameIdMatch,
    bookMatch,
    pickMatch,
    gameMatch,
    oddsMatch
  };
}

function findBestHistoryRow(target = {}, rows = []) {
  let bestRow = null;
  let bestScore = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const score = scoreHistoryRow(target, row);
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }
  return { row: bestRow, score: bestScore, matchStrength: bestRow ? getMatchStrength(target, bestRow) : { strong: false } };
}

function findBestResolvableHistoryRow(target = {}, rows = []) {
  let bestDirectRow = null;
  let bestDirectScore = 0;
  let bestFallbackRow = null;
  let bestFallbackScore = 0;
  let bestAnyRow = null;
  let bestAnyScore = 0;

  const rowHasResolvableIds = row => Boolean(
    row && (
      (row.gameId ?? row.game_id ?? row.gameID ?? row.game?.id) &&
      normalizeSelectionId(row.selectionId ?? row.selection_id ?? row.selectionID ?? row.selection)
    )
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const score = scoreHistoryRow(target, row);
    const matchStrength = getMatchStrength(target, row);
    const hasIds = rowHasResolvableIds(row);

    if (score > bestAnyScore || (score === bestAnyScore && hasIds && !rowHasResolvableIds(bestAnyRow))) {
      bestAnyScore = score;
      bestAnyRow = row;
    }

    if (!matchStrength.strong) continue;

    if (matchStrength.directIdMatch && (score > bestDirectScore || (score === bestDirectScore && hasIds && !rowHasResolvableIds(bestDirectRow)))) {
      bestDirectScore = score;
      bestDirectRow = row;
      continue;
    }

    if (!bestDirectRow && (score > bestFallbackScore || (score === bestFallbackScore && hasIds && !rowHasResolvableIds(bestFallbackRow)))) {
      bestFallbackScore = score;
      bestFallbackRow = row;
    }
  }

  const row = bestDirectRow || bestFallbackRow || bestAnyRow;
  const score = bestDirectRow ? bestDirectScore : bestFallbackRow ? bestFallbackScore : bestAnyScore;
  const resolvableScore = bestDirectRow ? bestDirectScore : bestFallbackRow ? bestFallbackScore : 0;
  return { row, score, resolvableScore, matchStrength: row ? getMatchStrength(target, row) : { strong: false } };
}

async function resolveHistoryForEntity({ client, target, rows, queryHistoryFn, lookbackHours = 12, nowMs = Date.now(), historySportsbooks = [], preferredBook = null, sharpBooks = [] }) {
  if (!client || typeof queryHistoryFn !== 'function' || !Array.isArray(rows) || rows.length === 0) {
    return {
      lineHistory: [],
      lineHistoryAvailable: false,
      lineHistorySource: null,
      matchedRow: null,
      matchStrength: { strong: false },
      normalizedSelectionId: null,
      historyGameId: null,
      historyMatchedBy: null
    };
  }

  const { row: matchedRow, score, resolvableScore, matchStrength } = findBestResolvableHistoryRow(target, rows);
  if (!matchedRow || score <= 0 || !matchStrength.strong) {
    return {
      lineHistory: [],
      lineHistoryAvailable: false,
      lineHistorySource: null,
      matchedRow: null,
      matchStrength,
      normalizedSelectionId: null,
      historyGameId: null,
      historyMatchedBy: null
    };
  }

  const gameId = matchedRow.gameId
    ?? matchedRow.game_id
    ?? matchedRow.gameID
    ?? matchedRow.game?.id
    ?? target.gameId
    ?? target.game_id
    ?? target.gameID
    ?? target.game?.id
    ?? null;
  const selectionId = normalizeSelectionId(
    matchedRow.selectionId
    ?? matchedRow.selection_id
    ?? matchedRow.selectionID
    ?? matchedRow.selection
    ?? target.selectionId
    ?? target.selection_id
    ?? target.selectionID
    ?? target.selection
  );
  if (!gameId || !selectionId) {
    return { lineHistory: [], lineHistoryAvailable: false, lineHistorySource: null, matchedRow, matchStrength };
  }

  const startTimestamp = getOddsHistoryStartTimestamp({ lookbackHours, nowMs });
  const requestedSportsbooks = Array.from(new Set([
    ...((Array.isArray(historySportsbooks) ? historySportsbooks : []).map(value => String(value || '').trim()).filter(Boolean)),
    ...[preferredBook].map(value => String(value || '').trim()).filter(Boolean),
    ...((Array.isArray(sharpBooks) ? sharpBooks : []).map(value => String(value || '').trim()).filter(Boolean))
  ]));
  const payload = await queryHistoryFn({ gameId, selectionId, sportsbooks: requestedSportsbooks, startTimestamp });
  const lineHistory = normalizeHistoryPayload(payload);
  if (lineHistory.length < 2) {
    return { lineHistory: [], lineHistoryAvailable: false, lineHistorySource: null, matchedRow, matchStrength };
  }

  return {
    lineHistory,
    lineHistoryAvailable: true,
    lineHistorySource: 'odds_history',
    matchedRow,
    matchStrength,
    normalizedSelectionId: selectionId,
    historyGameId: gameId,
    historyMatchedBy: matchStrength.directIdMatch ? 'selectionId' : matchStrength.gameIdMatch ? 'gameId' : 'fallback',
    historyMatchKey: matchStrength.directIdMatch ? 'selectionId' : matchStrength.gameIdMatch ? 'gameId' : null,
    historySportsbooksRequested: requestedSportsbooks
  };
}

module.exports = {
  findBestHistoryRow,
  normalizeHistoryPayload,
  normalizeHistoryPoint,
  normalizeSelectionId,
  resolveHistoryForEntity,
  scoreHistoryRow,
  getMatchStrength,
  getOddsHistoryStartTimestamp
};
