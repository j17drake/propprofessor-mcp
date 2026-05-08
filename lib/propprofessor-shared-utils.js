'use strict';

function americanOddsToImpliedProbability(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return -n / (-n + 100);
}

function parseHistoryTimeMs(value) {
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

function normalizeMarketName(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (['pts', 'point', 'points', 'player points', 'player point'].includes(raw)) return 'points';
  if (['ast', 'assists', 'player assists'].includes(raw)) return 'assists';
  if (['reb', 'rebound', 'rebounds', 'player rebounds'].includes(raw)) return 'rebounds';
  if (['pra', 'points + rebounds + assists', 'points rebounds assists'].includes(raw)) return 'points+rebounds+assists';
  return raw.replace(/\s+/g, ' ');
}

function normalizeDirection(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (['o', 'over', '+'].includes(raw)) return 'over';
  if (['u', 'under', '-'].includes(raw)) return 'under';
  return raw;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

function getOddsHistoryStartTimestamp({ lookbackHours = getOddsHistoryLookbackHours(), nowMs = Date.now() } = {}) {
  const safeHours = getOddsHistoryLookbackHours(lookbackHours);
  const now = Number(nowMs);
  const safeNowMs = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, Math.floor(safeNowMs / 1000) - Math.floor(safeHours * 60 * 60));
}

module.exports = {
  americanOddsToImpliedProbability,
  getOddsHistoryStartTimestamp,
  normalizeDirection,
  normalizeMarketName,
  normalizeText,
  parseHistoryTimeMs,
  scoreRow
};
