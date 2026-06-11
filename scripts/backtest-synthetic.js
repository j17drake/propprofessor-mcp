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
  ['Lakers', 'Celtics'],
  ['Warriors', 'Nuggets'],
  ['Bucks', 'Heat'],
  ['76ers', 'Knicks'],
  ['Suns', 'Clippers'],
  ['Mavericks', 'Grizzlies'],
  ['Cavaliers', 'Pacers'],
  ['Timberwolves', 'Kings'],
  ['Thunder', 'Pelicans'],
  ['Hawks', 'Magic'],
  ['Raptors', 'Nets'],
  ['Bulls', 'Hornets']
];

const BOOKS = ['NoVigApp', 'Pinnacle', 'Circa', 'BetOnline', 'BookMaker', 'Fliff', 'DraftKings'];

// Seedable PRNG for deterministic test scenarios. Default uses Math.random.
// Tests call setRandomSeed(seed) to get reproducible scenarios; call
// setRandomSeed(null) (or resetRandomSeed) to go back to Math.random.
let _rng = null; // null → use Math.random; otherwise a function returning [0, 1)

function setRandomSeed(seed) {
  if (seed == null) {
    _rng = null;
    return;
  }
  // mulberry32 — small, fast, good enough for scenario generation
  let a = seed >>> 0;
  _rng = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resetRandomSeed() {
  setRandomSeed(null);
}

function _rand() {
  return _rng ? _rng() : Math.random();
}

function randomInt(min, max) {
  return Math.floor(_rand() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(_rand() * arr.length)];
}

/**
 * Generate a single synthetic game scenario with a known outcome.
 *
 * The outcome is determined by the "true probability" — if the favorite's
 * true prob > 0.5, they win. The odds are generated with deliberate
 * mispricing at the target book to create real edge conditions that the
 * ranking engine should detect.
 *
 * Three scenario types:
 * - 'sharp_move': Sharp books moved, target book is stale → high edge, should be TIER 1/2
 * - 'stable_no_edge': All books agree, no edge → coin flip, should be TIER 3/4
 * - 'adverse': Sharp books moving against the pick → should be TIER 4
 *
 * @returns {{ screenPayload, oddsHistory, outcome, description }}
 */
function generateScenario() {
  const [home, away] = randomChoice(TEAMS);
  const gameId = `synth-${Date.now()}-${_rand().toString(36).slice(2, 8)}`;

  // Determine "true" outcome — home team wins with some probability
  const homeWinProb = 0.35 + _rand() * 0.3; // 35-65% range
  const homeWins = _rand() < homeWinProb;

  // Choose scenario type — determines whether there's real edge
  const scenarioRoll = _rand();
  const scenarioType = scenarioRoll < 0.35 ? 'sharp_move' : scenarioRoll < 0.7 ? 'stable_no_edge' : 'adverse';

  // Base odds from true probability
  const baseOdds = Math.round(-100 / (homeWinProb - 0.01));

  // Build odds across books
  const odds = {};
  const history = {};
  const nowSec = Math.floor(Date.now() / 1000);

  // Sharp books reflect the "true" line
  const sharpOdds = baseOdds + randomInt(-3, 3);

  for (const book of BOOKS) {
    const isSharp = ['Pinnacle', 'Circa', 'BetOnline', 'BookMaker'].includes(book);
    const isTarget = book === 'Fliff' || book === 'NoVigApp';

    let bookOdds;
    if (scenarioType === 'sharp_move' && isTarget) {
      // Target book is STALE — hasn't caught up to the sharp move
      // This creates real positive edge for the pick
      bookOdds = sharpOdds + randomInt(15, 35); // Worse price for the favorite
    } else if (scenarioType === 'adverse' && isTarget) {
      // Target book is moving AGAINST the pick — adverse signal
      bookOdds = sharpOdds - randomInt(10, 25); // Better price = moving against
    } else if (isSharp) {
      bookOdds = sharpOdds + randomInt(-3, 3);
    } else {
      bookOdds = sharpOdds + randomInt(-8, 8);
    }

    bookOdds = Math.max(-300, Math.min(300, bookOdds));
    const awayOdds = Math.round(bookOdds > 0 ? -(bookOdds + 100) : -bookOdds + 100);
    odds[book] = { odds1: bookOdds, odds2: awayOdds };

    // Generate odds history
    const historyPoints = [];
    const hoursBack = 6;

    if (scenarioType === 'sharp_move') {
      // Sharp books show clear movement; target book is flat
      let currentOdds = sharpOdds - randomInt(10, 20); // Started lower
      for (let h = hoursBack; h >= 0; h--) {
        const ts = nowSec - h * 3600;
        if (isTarget) {
          // Target book barely moved
          historyPoints.push({ odds: bookOdds + randomInt(-2, 2), start_ts: ts });
        } else {
          // Sharp books gradually moved to current
          const progress = 1 - h / hoursBack;
          currentOdds = Math.round(currentOdds + (sharpOdds - currentOdds) * progress * 0.3);
          historyPoints.push({ odds: currentOdds + randomInt(-2, 2), start_ts: ts });
        }
      }
    } else if (scenarioType === 'adverse') {
      // Sharp books moving against the pick
      let currentOdds = sharpOdds + randomInt(5, 15);
      for (let h = hoursBack; h >= 0; h--) {
        const ts = nowSec - h * 3600;
        if (isTarget) {
          historyPoints.push({ odds: bookOdds + randomInt(-2, 2), start_ts: ts });
        } else {
          const progress = 1 - h / hoursBack;
          currentOdds = Math.round(currentOdds + (sharpOdds - currentOdds) * progress * 0.3);
          historyPoints.push({ odds: currentOdds + randomInt(-2, 2), start_ts: ts });
        }
      }
    } else {
      // Stable — all books roughly the same, minimal movement
      for (let h = hoursBack; h >= 0; h--) {
        const ts = nowSec - h * 3600;
        historyPoints.push({ odds: sharpOdds + randomInt(-3, 3), start_ts: ts });
      }
    }

    // Only include history for some books
    if (_rand() > 0.15) {
      history[book] = historyPoints;
    }
  }

  // Build screen payload
  const screenPayload = {
    game_data: [
      {
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
      }
    ]
  };

  const description = `${scenarioType}_${homeWins ? home.replace(/\s+/g, '_') : away.replace(/\s+/g, '_')}_wins`;

  return {
    screenPayload,
    oddsHistory: { [gameId]: history },
    outcome: homeWins ? home : away,
    gameId,
    description,
    scenarioType
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
    const { screenPayload, oddsHistory, outcome, gameId } = generateScenario();

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
    const status =
      total === 0
        ? ''
        : tier === 'TIER 1' && wins / total >= 0.6
          ? ' ✅ healthy'
          : tier === 'TIER 1' && wins / total >= 0.55
            ? ' ⚠️ borderline'
            : tier === 'TIER 1'
              ? ' ❌ below target'
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

module.exports = { runBacktest, report, generateScenario, setRandomSeed, resetRandomSeed };
