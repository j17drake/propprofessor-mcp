#!/usr/bin/env node
'use strict';

// CLI: node scripts/backtest.js [league] [market] [days]
// Defaults: MLB Moneyline 30
//
// Backtest the tier system by pulling screen data and checking outcomes
// for resolved bets. Groups by confidence tier and reports hit rates.

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { extractScreenRows } = require('../lib/propprofessor-screen-utils');
const { getConfidenceTier } = require('../lib/propprofessor-risk-score');

/**
 * Parse CLI arguments into an options object.
 * @param {string[]} argv - process.argv (includes node and script path)
 * @returns {{ league: string, market: string, days: number }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    league: args[0] || 'MLB',
    market: args[1] || 'Moneyline',
    days: parseInt(args[2], 10) || 30
  };
}

/**
 * Determine the outcome of a resolved bet row.
 * Looks for common field names used by the PropProfessor API.
 * @param {Object} row
 * @returns {'win'|'loss'|'push'|null}
 */
function resolveOutcome(row) {
  if (!row || typeof row !== 'object') return null;
  const raw = row.outcome ?? row.result ?? row.settled ?? row.status ?? null;
  if (!raw) return null;
  const value = String(raw).toLowerCase().trim();
  if (value === 'win' || value === 'won' || value === 'w' || value === 'green') return 'win';
  if (value === 'loss' || value === 'lost' || value === 'l' || value === 'red') return 'loss';
  if (value === 'push' || value === 'tie' || value === 'no_decision' || value === 'void') return 'push';
  return null;
}

/**
 * Run a backtest of the tier system.
 * @param {Object} opts
 * @param {string} [opts.league='MLB']
 * @param {string} [opts.market='Moneyline']
 * @param {number} [opts.days=30]
 * @returns {Promise<{ ok: boolean, reason?: string, tiers?: Object, error?: string }>}
 */
async function backtest({ league = 'MLB', market = 'Moneyline', days = 30 } = {}) {
  console.log(`Backtesting ${league} ${market} for the last ${days} days...\n`);

  const client = createPropProfessorClient();

  try {
    const payload = await client.queryScreenOdds({ league, market });
    const rows = extractScreenRows(payload);

    // Filter to rows that have outcome data
    const resolved = rows
      .map((row) => ({ ...row, __outcome: resolveOutcome(row) }))
      .filter((row) => row.__outcome !== null);

    if (!resolved.length) {
      console.log('No resolved bets found in the data.');
      console.log('Note: The screen endpoint returns current odds, not historical results.');
      console.log('Backtesting requires access to settled bet history, which may not be');
      console.log('available via the current API.');
      console.log('');
      console.log('To validate the tier system, run this script periodically and track');
      console.log('outcomes manually, or use the screen-history module to persist snapshots.');
      return { ok: false, reason: 'no_historical_data' };
    }

    // Group by tier and calculate hit rates
    const byTier = {};
    for (const row of resolved) {
      const tier = getConfidenceTier(row);
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(row);
    }

    // Print results table
    console.log('Tier\t\tTotal\tWins\tLosses\tPush\tHit Rate');
    console.log('----\t\t-----\t----\t------\t----\t--------');

    const sortedTiers = Object.entries(byTier).sort(([a], [b]) => a.localeCompare(b));
    for (const [tier, bets] of sortedTiers) {
      const wins = bets.filter((b) => b.__outcome === 'win').length;
      const losses = bets.filter((b) => b.__outcome === 'loss').length;
      const pushes = bets.filter((b) => b.__outcome === 'push').length;
      const decidable = wins + losses;
      const hitRate = decidable > 0 ? ((wins / decidable) * 100).toFixed(1) : '0.0';
      console.log(`${tier}\t\t${bets.length}\t${wins}\t${losses}\t${pushes}\t${hitRate}%`);
    }

    console.log('\n✓ Backtest complete.');
    return { ok: true, tiers: byTier };
  } catch (err) {
    console.error('Backtest failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// CLI entry point
if (require.main === module) {
  const opts = parseArgs(process.argv);
  backtest(opts).then((result) => {
    process.exit(result.ok ? 0 : 1);
  });
}

module.exports = { backtest, parseArgs, resolveOutcome };
