'use strict';

/**
 * Synthetic backtest for the PropProfessor ranking engine.
 *
 * Generates realistic game scenarios with KNOWN outcomes, runs them through
 * the full pipeline (expand → hydrate → rank → tier), and reports hit rates
 * by tier. Validates that the tier system actually differentiates quality.
 *
 * Usage:
 *   node scripts/backtest-synthetic.js [--scenarios=500] [--verbose]
 *
 * Expected results (from docs/BACKTESTING.md):
 *   TIER 1 hit rate > 60% = healthy
 *   TIER 1 ≈ TIER 3 = tier system not differentiating
 *   TIER 4 > TIER 2 = red flags are wrong
 */

const { rankLeagueScreenRows } = require('../lib/screen-ranker');
const { extractScreenRows } = require('../lib/propprofessor-screen-utils');

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

const TEAMS = [
  ['Lakers', 'Celtics'], ['Warriors', 'Nuggets'], ['Bucks', 'Heat'],
  ['76ers', 'Knicks'], ['Suns', 'Clippers'], ['Mavericks', 'Grizzlies'],
  ['Cavaliers', 'Pacers'], ['Timberwolves', 'Kings'], ['Thunder', 'Pelicans'],
  ['Hawks', 'Magic'], ['Raptors', 'Nets'], ['Bulls', 'Hornets']
];

const BOOKS = ['NoVigApp', 'Pinnacle', 'Circa', 'BetOnline', 'BookMaker', 'Fliff', 'DraftKings'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a single synthetic game scenario with a known outcome.
 *
 * The outcome is determined by the "true probability" — if the favorite's
 * true prob > 0.5, they win. The odds are generated with varying degrees
 * of sharp consensus and movement to exercise different ranking paths.
 *
 * @returns {{ screenPayload, oddsHistory, outcome, description }}
 */
function generateScenario() {
  const [home, away] = randomChoice(TEAMS);
  const gameId = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Determine "true" outcome — home team wins with some probability
  const homeWinProb = 0.3 + Math.random() * 0.4; // 30-70% range
  const homeWins = Math.random() < homeWinProb;

  // Generate odds with varying consensus quality
  const consensusQuality = Math.random(); // 0 = no consensus, 1 = strong consensus
  const hasSharpMovement = Math.random() > 0.5;
  const baseOdds = Math.round(-100 / (homeWinProb - 0.01)); // Implied from true prob

  // Build odds across books
  const odds = {};
  const history = {};
  const nowSec = Math.floor(Date.now() / 1000);

  for (const book of BOOKS) {
    const isSharp = ['Pinnacle', 'Circa', 'BetOnline', 'BookMaker'].includes(book);
    const isLagging = book === 'Fliff' && hasSharpMovement;

    // Sharp books move toward the true line; lagging books stay stale
    let bookOdds;
    if (isLagging) {
      bookOdds = baseOdds + randomInt(-5, 5); // Stale — doesn't move
    } else if (isSharp) {
      bookOdds = baseOdds + randomInt(-3, 3); // Tight to true line
    } else {
      bookOdds = baseOdds + randomInt(-8, 8); // More noise
    }

    // Ensure odds are valid American odds
    bookOdds = Math.max(-300, Math.min(300, bookOdds));
    const awayOdds = Math.round(bookOdds > 0 ? -(bookOdds + 100) : (-bookOdds + 100));

    odds[book] = { odds1: bookOdds, odds2: awayOdds };

    // Generate odds history (movement over 6 hours)
    const historyPoints = [];
    const hoursBack = 6;
    let currentOdds = bookOdds;

    for (let h = hoursBack; h >= 0; h--) {
      const ts = nowSec - h * 3600;
      if (isLagging && h < hoursBack / 2) {
        // Lagging book stops moving after the first half
        historyPoints.push({ odds: currentOdds, start_ts: ts });
      } else {
        // Gradual movement toward final value
        const drift = hasSharpMovement && isSharp
          ? Math.round((bookOdds - baseOdds) * (1 - h / hoursBack) * 0.8)
          : randomInt(-2, 2);
        currentOdds = baseOdds + drift;
        currentOdds = Math.max(-300, Math.min(300, currentOdds));
        historyPoints.push({ odds: currentOdds, start_ts: ts });
      }
    }

    // Only include history for some books (not all have data)
    if (Math.random() > 0.2) {
      history[book] = historyPoints;
    }
  }

  // Build screen payload
  const screenPayload = {
    game_data: [{
      gameId,
      league: 'NBA',
      market: 'Moneyline',
      updatedAt: new Date().toISOString(),
      homeTeam: home,
      awayTeam: away,
      selections: {
        ml: {
          selection1: home,
          participant1: home,
          selection1Id: `Moneyline:${home.replace(/\s+/g, '_')}`,
          selection2: away,
          participant2: away,
          selection2Id: `Moneyline:${away.replace(/\s+/g, '_')}`,
          odds
        }
      },
      defaultKey: 'ml'
    }]
  };

  const description = [
    hasSharpMovement ? 'sharp_move' : 'stable',
    consensusQuality > 0.7 ? 'strong_consensus' : consensusQuality > 0.3 ? 'moderate' : 'weak',
    homeWins ? `${home}_wins` : `${away}_wins`
  ].join('_');

  return {
    screenPayload,
    oddsHistory: { [gameId]: history },
    outcome: homeWins ? home : away, // The winner
    gameId,
    description
  };
}

// ---------------------------------------------------------------------------
// Backtest runner
// ---------------------------------------------------------------------------

/**
 * Run a backtest across N synthetic scenarios.
 * @param {Object} options
 * @param {number} options.scenarios - Number of scenarios to generate
 * @param {boolean} options.verbose - Print per-scenario details
 * @returns {Object} Aggregate results by tier
 */
function runBacktest({ scenarios = 200, verbose = false } = {}) {
  const results = {
    'TIER 1': { wins: 0, losses: 0, plays: [] },
    'TIER 2': { wins: 0, losses: 0, plays: [] },
    'TIER 3': { wins: 0, losses: 0, plays: [] },
    'TIER 4': { wins: 0, losses: 0, plays: [] }
  };

  let errorCount = 0;

  for (let i = 0; i < scenarios; i++) {
    const { screenPayload, oddsHistory, outcome, gameId, description } = generateScenario();

    try {
      // Extract rows from screen payload
      const rows = extractScreenRows(screenPayload);

      // Enrich rows with odds history (simulate hydration)
      for (const row of rows) {
        const gameHistory = oddsHistory[gameId] || {};
        const bookHistory = gameHistory[row.book] || [];
        row.lineHistory = bookHistory.map((p) => ({
          time: new Date(p.start_ts * 1000).toISOString(),
          odds: p.odds,
          book: row.book
        }));
        row.openingOdds = bookHistory.length > 0 ? bookHistory[0].odds : row.odds;
      }

      // Rank rows through the full pipeline
      const ranked = rankLeagueScreenRows(rows, {
        league: 'NBA',
        market: 'Moneyline',
        limit: 20,
        includeAll: true,
        books: ['NoVigApp']
      });

      // Check each ranked row against the outcome
      for (const row of ranked) {
        const tier = row.confidenceTier || 'TIER 4';
        const kaiCall = row.kaiCall || 'PASS';
        const selection = row.selection || row.participant || '';
        const isHome = selection.includes(rows[0]?.selection1?.split(' ').pop() || '___');

        // The play is a "win" if the selected team won
        const selectedTeam = selection;
        const won = selectedTeam === outcome;

        if (!results[tier]) results[tier] = { wins: 0, losses: 0, plays: [] };

        results[tier][won ? 'wins' : 'losses'] += 1;
        if (verbose && tier === 'TIER 1') {
          results[tier].plays.push({
            selection: selectedTeam,
            odds: row.odds,
            won,
            kaiCall,
            riskScore: row.riskScore,
            movementGrade: row.movementGrade,
            consensusBookCount: row.consensusBookCount
          });
        }
      }
    } catch {
      errorCount++;
    }
  }

  return { results, scenarios, errorCount };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(backtestResults) {
  const { results, scenarios, errorCount } = backtestResults;

  console.log('='.repeat(60));
  console.log('PropProfessor Synthetic Backtest');
  console.log('='.repeat(60));
  console.log(`Scenarios: ${scenarios}  |  Errors: ${errorCount}`);
  console.log('');

  const tierOrder = ['TIER 1', 'TIER 2', 'TIER 3', 'TIER 4'];
  const summary = {};

  for (const tier of tierOrder) {
    const { wins, losses } = results[tier] || { wins: 0, losses: 0 };
    const total = wins + losses;
    const hitRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    const status = total === 0 ? ''
      : tier === 'TIER 1' && wins / total >= 0.6 ? ' ✅ healthy'
      : tier === 'TIER 1' && wins / total >= 0.55 ? ' ⚠️ borderline'
      : tier === 'TIER 1' ? ' ❌ below target'
      : '';

    summary[tier] = { wins, losses, total, hitRate };
    console.log(`${tier}: ${hitRate}% (${wins}W/${losses}L/${total} total)${status}`);
  }

  console.log('');

  // Differentiation check
  const t1 = summary['TIER 1'];
  const t2 = summary['TIER 2'];
  const t3 = summary['TIER 3'];
  const t4 = summary['TIER 4'];

  if (t1.total > 0 && t3.total > 0) {
    const t1Rate = t1.wins / t1.total;
    const t3Rate = t3.wins / t3.total;
    const diff = ((t1Rate - t3Rate) * 100).toFixed(1);
    console.log(`TIER 1 vs TIER 3 gap: ${diff}pp`);
    if (t1Rate > t3Rate + 0.05) {
      console.log('✅ Tier system differentiates — TIER 1 outperforms TIER 3');
    } else {
      console.log('⚠️  TIER 1 ≈ TIER 3 — tier system may not be differentiating well');
    }
  }

  if (t4.total > 0 && t2.total > 0) {
    const t4Rate = t4.wins / t4.total;
    const t2Rate = t2.wins / t2.total;
    if (t4Rate > t2Rate) {
      console.log('❌ TIER 4 > TIER 2 — red flags may be wrong');
    } else {
      console.log('✅ TIER 4 ≤ TIER 2 — risk flags are directionally correct');
    }
  }

  console.log('');
  console.log('='.repeat(60));

  return summary;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const scenariosArg = args.find((a) => a.startsWith('--scenarios='));
  const scenarios = scenariosArg ? parseInt(scenariosArg.split('=')[1], 10) : 200;

  const results = runBacktest({ scenarios, verbose });
  const summary = report(results);

  // Exit with error if TIER 1 is below 55%
  const t1 = summary['TIER 1'];
  if (t1.total > 0 && t1.wins / t1.total < 0.55) {
    process.exit(1);
  }
}

module.exports = { runBacktest, report, generateScenario };
