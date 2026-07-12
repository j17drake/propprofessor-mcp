'use strict';

/**
 * Financial backtest metrics for resolved prop bets.
 *
 * The PropProfessor API does not serve historical resolved results, so outcomes
 * are recorded by the user against saved snapshots (scripts/backtest.js
 * --resolve). Each resolved play carries the taken odds, the stake, and the
 * actual result. From that we compute the metrics a bettor actually cares about:
 * P&L, ROI, Sharpe (risk-adjusted return), and max drawdown.
 *
 * All functions here are PURE and unit-tested — no I/O, no live API.
 */

/**
 * Profit (in dollars) for a single resolved play.
 * @param {number} odds - American odds taken (e.g. -110, +150)
 * @param {number} stake - dollars wagered
 * @param {string} result - 'won' | 'lost' | 'push'
 * @returns {number} net profit (negative on a loss, 0 on push)
 */
function playProfit(odds, stake, result) {
  if (result === 'push') return 0;
  if (result === 'lost') return -stake;
  // won
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

/**
 * Compute aggregate metrics from a list of resolved plays.
 * @param {Array<{odds:number, stake:number, result:string}>} plays
 * @returns {{
 *   bets: number,
 *   wins: number, losses: number, pushes: number,
 *   winRate: number|null,
 *   profit: number,
 *   roi: number|null,
 *   sharpe: number|null,
 *   maxDrawdown: number
 * }}
 */
function computeBacktestMetrics(plays) {
  const safePlays = Array.isArray(plays) ? plays : [];
  const wins = safePlays.filter((p) => p.result === 'won').length;
  const losses = safePlays.filter((p) => p.result === 'lost').length;
  const pushes = safePlays.filter((p) => p.result === 'push').length;
  const decidable = wins + losses;

  let profit = 0;
  let totalStaked = 0;
  for (const p of safePlays) {
    const stake = Number.isFinite(Number(p.stake)) ? Number(p.stake) : 0;
    totalStaked += stake;
    profit += playProfit(Number(p.odds), stake, p.result);
  }

  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : null;
  const winRate = decidable > 0 ? (wins / decidable) * 100 : null;
  const sharpe = computeSharpe(safePlays);
  const maxDrawdown = computeMaxDrawdown(safePlays);

  return {
    bets: safePlays.length,
    wins,
    losses,
    pushes,
    winRate: winRate === null ? null : Math.round(winRate * 10) / 10,
    profit: Math.round(profit * 100) / 100,
    roi: roi === null ? null : Math.round(roi * 10) / 10,
    sharpe,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100
  };
}

/**
 * Per-play return (as a ratio of stake) used for Sharpe.
 * @returns {number[]} return multiples, one per play (push = 0)
 */
function playReturns(plays) {
  return plays.map((p) => {
    const stake = Number.isFinite(Number(p.stake)) ? Number(p.stake) : 0;
    if (stake === 0) return 0;
    return playProfit(Number(p.odds), stake, p.result) / stake;
  });
}

/**
 * Annualized-ish Sharpe ratio of per-play returns.
 * Uses sample stdev; returns null when fewer than 2 plays or zero variance.
 * @param {Array} plays
 * @returns {number|null}
 */
function computeSharpe(plays) {
  const rets = playReturns(plays);
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return null;
  return Math.round((mean / stdev) * 100) / 100;
}

/**
 * Maximum drawdown: the largest peak-to-trough drop in the running
 * cumulative profit curve.
 * @param {Array} plays
 * @returns {number} a non-positive number (0 means no drawdown)
 */
function computeMaxDrawdown(plays) {
  let peak = 0;
  let running = 0;
  let maxDd = 0;
  for (const p of plays) {
    const stake = Number.isFinite(Number(p.stake)) ? Number(p.stake) : 0;
    running += playProfit(Number(p.odds), stake, p.result);
    if (running > peak) peak = running;
    const dd = running - peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

module.exports = {
  playProfit,
  computeBacktestMetrics,
  computeSharpe,
  computeMaxDrawdown,
  playReturns
};
