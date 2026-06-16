#!/usr/bin/env node
'use strict';

/**
 * Daily snapshot cron — captures pre-game odds for backtest data collection.
 *
 * Runs via Hermes cron (no_agent: true). Silent on success, alerts on failure.
 * Saves snapshots to backtest-data/ for later resolution.
 *
 * Captures: NBA Moneyline, MLB Moneyline, NHL Moneyline (if in season).
 * Add/remove leagues as needed.
 */

const { takeSnapshot } = require('./backtest');
const { DEFAULT_LEAGUES } = require('../lib/propprofessor-shared-utils');

// SUPPORTED_LEAGUES is the UPPERCASE, sorted, de-duped view of every league
// the PropProfessor backend supports. Derived from the same single source of
// truth (DEFAULT_LEAGUES) so the API-request payload, the CLI defaults, and
// the snapshot guard can never drift out of sync.
const SUPPORTED_LEAGUES = new Set(DEFAULT_LEAGUES.map((league) => league.toUpperCase()));

const SNAPSHOTS = [
  { league: 'NBA', market: 'Moneyline' },
  { league: 'MLB', market: 'Moneyline' },
  { league: 'NHL', market: 'Moneyline' }
];

async function main() {
  // Suppress takeSnapshot console.log — we only want output on errors
  const origLog = console.log;
  const captured = [];
  console.log = (...args) => captured.push(args.join(' '));

  const results = [];
  const errors = [];

  for (const { league, market } of SNAPSHOTS) {
    // Guard: skip unsupported leagues
    if (!SUPPORTED_LEAGUES.has(league.toUpperCase())) {
      console.log = origLog;
      console.warn(
        `[backtest-daily-snapshot] Skipping unsupported league: ${league} ` +
          `(supported: ${[...SUPPORTED_LEAGUES].join(', ')})`
      );
      console.log = (...args) => captured.push(args.join(' '));
      continue;
    }

    try {
      const result = await takeSnapshot({ league, market });
      results.push({ league, market, ...result });
    } catch (err) {
      errors.push({ league, market, error: err.message });
    }
  }

  console.log = origLog;

  if (errors.length === SNAPSHOTS.length) {
    console.log(`🔴 Daily snapshot failed — all ${errors.length} leagues errored:`);
    for (const e of errors) {
      console.log(`  ${e.league} ${e.market}: ${e.error}`);
    }
    console.log('\nRun: pp-query doctor');
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`🟡 Daily snapshot partial failure (${errors.length}/${SNAPSHOTS.length} failed):`);
    for (const e of errors) {
      console.log(`  ${e.league} ${e.market}: ${e.error}`);
    }
    for (const r of results) {
      console.log(`  ✅ ${r.league} ${r.market}: ${r.rows} rows`);
    }
    process.exit(0);
  }

  // All success — silent (no output = no cron notification)
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { SUPPORTED_LEAGUES };
