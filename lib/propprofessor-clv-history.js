'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_BET_LOG_PATH = path.join(os.homedir(), 'Documents', 'bet-log.csv');
const DEFAULT_GROUPS = ['week', 'sport', 'tier', 'book'];

/**
 * Parse a single CSV line, respecting quoted fields with commas.
 * Returns array of string fields.
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

const REQUIRED_COLUMNS = [
  'date', 'league', 'market', 'selection', 'book',
  'odds_taken', 'closing_odds', 'outcome', 'stake', 'tier'
];

/**
 * Read and parse a bet log CSV file.
 * Returns { bets: [...], errors: [...] }.
 * Skips rows that fail validation but records the error.
 */
function readBetLog(filePath) {
  const target = filePath || DEFAULT_BET_LOG_PATH;
  let content;
  try {
    content = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { bets: [], errors: [`Bet log not found at ${target}`], path: target };
    }
    return { bets: [], errors: [`Failed to read ${target}: ${err.message}`], path: target };
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { bets: [], errors: ['Bet log is empty'], path: target };
  }

  // Validate header
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      bets: [],
      errors: [`Missing required columns: ${missing.join(', ')}. Found: ${header.join(', ')}`],
      path: target
    };
  }

  const idx = (col) => header.indexOf(col);
  const bets = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    try {
      const date = fields[idx('date')]?.trim();
      const oddsTaken = Number(fields[idx('odds_taken')]);
      const closingOdds = Number(fields[idx('closing_odds')]);
      const stake = Number(fields[idx('stake')]);
      const outcome = fields[idx('outcome')]?.trim().toLowerCase();
      if (!date) throw new Error('missing date');
      if (!Number.isFinite(oddsTaken)) throw new Error(`invalid odds_taken: ${fields[idx('odds_taken')]}`);
      if (!Number.isFinite(closingOdds)) throw new Error(`invalid closing_odds: ${fields[idx('closing_odds')]}`);
      if (!Number.isFinite(stake)) throw new Error(`invalid stake: ${fields[idx('stake')]}`);
      if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'push') {
        throw new Error(`invalid outcome: ${fields[idx('outcome')]} (must be win/loss/push)`);
      }
      bets.push({
        date,
        league: fields[idx('league')]?.trim(),
        market: fields[idx('market')]?.trim(),
        selection: fields[idx('selection')]?.trim(),
        book: fields[idx('book')]?.trim(),
        oddsTaken,
        closingOdds,
        outcome,
        stake,
        tier: fields[idx('tier')]?.trim() || '?',
        // Computed below
        clvPercent: null,
        profit: null
      });
    } catch (err) {
      errors.push(`Line ${i + 1}: ${err.message}`);
    }
  }

  // Compute CLV and profit
  for (const bet of bets) {
    bet.clvPercent = computeClvPercent(bet.oddsTaken, bet.closingOdds);
    bet.profit = computeProfit(bet.oddsTaken, bet.stake, bet.outcome);
  }

  return { bets, errors, path: target };
}

/**
 * Compute CLV as a percent. Positive = you beat the close.
 *
 * Standard industry formula uses decimal odds ratio:
 *   CLV% = (decimal_odds_taken / decimal_odds_close - 1) × 100
 *
 * This works for both favorites and underdogs:
 *   Favorite -130 → -150: you got better price (less juice) → positive CLV
 *   Underdog +150 → +130: you got better price (more payout) → positive CLV
 *
 * Note: CLV measures the QUALITY of the price you got, NOT whether you won.
 * A losing bet at great odds still has positive CLV.
 */
function computeClvPercent(oddsTaken, closingOdds) {
  const decTaken = americanToDecimal(oddsTaken);
  const decClose = americanToDecimal(closingOdds);
  if (!Number.isFinite(decTaken) || !Number.isFinite(decClose) || decClose === 0) return null;
  return (decTaken / decClose - 1) * 100;
}

function americanToDecimal(odds) {
  if (!Number.isFinite(odds)) return NaN;
  if (odds >= 100) return 1 + odds / 100;
  if (odds <= -100) return 1 + 100 / -odds;
  return NaN;
}

function americanToImpliedProb(odds) {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

function computeProfit(odds, stake, outcome) {
  if (outcome === 'push') return 0;
  if (outcome === 'win') {
    if (odds > 0) return stake * (odds / 100);
    return stake * (100 / -odds);
  }
  // loss
  return -stake;
}

/**
 * Compute mean of a numeric array, ignoring nulls.
 */
function mean(arr) {
  const valid = arr.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function stddev(arr) {
  const valid = arr.filter((v) => Number.isFinite(v));
  if (valid.length < 2) return 0;
  const m = mean(valid);
  const variance = valid.reduce((sum, v) => sum + (v - m) ** 2, 0) / (valid.length - 1);
  return Math.sqrt(variance);
}

/**
 * Group bets by a key derived from each bet. Returns array of { key, bets, stats }.
 */
function groupBets(bets, groupBy) {
  const groups = new Map();
  for (const bet of bets) {
    const key = groupKey(bet, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bet);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    count: items.length,
    clvMean: Number(mean(items.map((b) => b.clvPercent)).toFixed(2)),
    clvStddev: Number(stddev(items.map((b) => b.clvPercent)).toFixed(2)),
    winRate: Number((items.filter((b) => b.outcome === 'win').length / items.length).toFixed(4)),
    profit: Number(items.reduce((sum, b) => sum + b.profit, 0).toFixed(2)),
    totalStake: Number(items.reduce((sum, b) => sum + b.stake, 0).toFixed(2)),
    roi: Number((items.reduce((sum, b) => sum + b.profit, 0) / items.reduce((sum, b) => sum + b.stake, 0) * 100).toFixed(2))
  })).sort((a, b) => b.count - a.count);
}

function groupKey(bet, groupBy) {
  if (groupBy === 'week') {
    // ISO week: YYYY-Www
    const d = new Date(bet.date);
    if (isNaN(d.getTime())) return bet.date;
    const year = d.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((d - start) / 86400000) + 1;
    const week = Math.ceil((dayOfYear + start.getUTCDay()) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  if (groupBy === 'sport') return bet.league || 'unknown';
  if (groupBy === 'tier') return bet.tier || 'unknown';
  if (groupBy === 'book') return bet.book || 'unknown';
  return 'all';
}

/**
 * Top-level: build CLV history summary.
 * @param {Object} options
 * @param {number} [options.days=30] - Lookback window
 * @param {string} [options.groupBy='week'] - One of: week, sport, tier, book
 * @param {string} [options.path] - Override bet log path
 * @returns {Object} { ok, totalBets, ...stats, byGroup, warnings }
 */
function getClvHistory(options = {}) {
  const { days = 30, groupBy = 'week', path: logPath } = options;

  if (!DEFAULT_GROUPS.includes(groupBy)) {
    return { ok: false, error: `Invalid groupBy: ${groupBy}. Must be one of ${DEFAULT_GROUPS.join(', ')}` };
  }

  const { bets, errors, path: resolvedPath } = readBetLog(logPath);
  if (errors.length > 0 && bets.length === 0) {
    return { ok: false, error: errors.join('; '), path: resolvedPath, warnings: errors };
  }

  // Filter by date
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = bets.filter((b) => {
    const t = Date.parse(b.date);
    if (!Number.isFinite(t)) return false; // skip unparseable dates
    return t >= cutoffMs;
  });

  if (recent.length === 0) {
    return {
      ok: true,
      path: resolvedPath,
      days,
      groupBy,
      totalBets: 0,
      message: `No bets in the last ${days} days. Add rows to your bet log and try again.`,
      warnings: errors
    };
  }

  const clvValues = recent.map((b) => b.clvPercent);
  const totalProfit = recent.reduce((sum, b) => sum + b.profit, 0);
  const totalStake = recent.reduce((sum, b) => sum + b.stake, 0);
  const wins = recent.filter((b) => b.outcome === 'win').length;

  return {
    ok: true,
    path: resolvedPath,
    days,
    groupBy,
    totalBets: recent.length,
    avgClv: Number(mean(clvValues).toFixed(2)),
    clvStddev: Number(stddev(clvValues).toFixed(2)),
    winRate: Number((wins / recent.length).toFixed(4)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalStake: Number(totalStake.toFixed(2)),
    roi: Number((totalProfit / totalStake * 100).toFixed(2)),
    byGroup: groupBets(recent, groupBy),
    warnings: errors
  };
}

module.exports = {
  readBetLog,
  computeClvPercent,
  computeProfit,
  americanToImpliedProb,
  americanToDecimal,
  getClvHistory,
  groupBets,
  parseCsvLine,
  DEFAULT_BET_LOG_PATH,
  DEFAULT_GROUPS
};
