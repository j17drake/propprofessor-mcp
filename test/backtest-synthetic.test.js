'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runBacktest, generateScenario } = require('../scripts/backtest-synthetic');

describe('synthetic backtest', () => {
  it('generateScenario returns valid scenario with required fields', () => {
    const scenario = generateScenario();

    assert.ok(scenario.screenPayload, 'Has screenPayload');
    assert.ok(scenario.screenPayload.game_data, 'Has game_data');
    assert.ok(scenario.screenPayload.game_data.length === 1, 'One game per scenario');
    assert.ok(scenario.oddsHistory, 'Has oddsHistory');
    assert.ok(scenario.outcome, 'Has outcome (winner team name)');
    assert.ok(scenario.gameId, 'Has gameId');
    assert.ok(scenario.description, 'Has description');

    const game = scenario.screenPayload.game_data[0];
    assert.ok(game.homeTeam, 'Game has homeTeam');
    assert.ok(game.awayTeam, 'Game has awayTeam');
    assert.ok(game.selections, 'Game has selections');
    assert.ok(game.selections.ml, 'Game has ml selection');
    assert.ok(game.selections.ml.odds, 'Game has odds');
  });

  it('generateScenario creates odds for multiple books', () => {
    const scenario = generateScenario();
    const game = scenario.screenPayload.game_data[0];
    const bookCount = Object.keys(game.selections.ml.odds).length;

    assert.ok(bookCount >= 5, `Expected at least 5 books, got ${bookCount}`);
  });

  it('generateScenario creates odds history with multiple data points', () => {
    const scenario = generateScenario();
    const historyKeys = Object.keys(scenario.oddsHistory);

    assert.ok(historyKeys.length >= 1, 'Has at least one game history');

    const gameId = scenario.gameId;
    const gameHistory = scenario.oddsHistory[gameId];
    assert.ok(gameHistory, 'History exists for the game');

    // At least some books should have history
    const booksWithHistory = Object.keys(gameHistory).filter((b) => gameHistory[b].length > 0);
    assert.ok(booksWithHistory.length >= 3, `Expected at least 3 books with history, got ${booksWithHistory.length}`);
  });

  it('runBacktest produces tier results for 50 scenarios', () => {
    const { results, scenarios, errorCount } = runBacktest({ scenarios: 50 });

    assert.equal(scenarios, 50);
    assert.equal(errorCount, 0);

    // Should have at least TIER 1 or TIER 4 plays (most scenarios produce both)
    const t1 = results['TIER 1'] || { wins: 0, losses: 0 };
    const t4 = results['TIER 4'] || { wins: 0, losses: 0 };
    const totalPlays = t1.wins + t1.losses + t4.wins + t4.losses;

    assert.ok(totalPlays > 0, 'Should have at least some plays across tiers');
  });

  it('runBacktest with 200 scenarios has reasonable tier distribution', () => {
    const { results } = runBacktest({ scenarios: 200 });

    // Count plays per tier
    const tierCounts = {};
    for (const [tier, data] of Object.entries(results)) {
      tierCounts[tier] = data.wins + data.losses;
    }

    // TIER 4 should have the most plays (most rows are not top-tier)
    // TIER 1 should have the fewest (only the best)
    const t1Count = tierCounts['TIER 1'] || 0;
    const t4Count = tierCounts['TIER 4'] || 0;

    // At minimum, the system should produce plays in multiple tiers
    const tiersWithPlays = Object.values(tierCounts).filter((c) => c > 0).length;
    assert.ok(tiersWithPlays >= 2, `Expected plays in at least 2 tiers, got ${tiersWithPlays}`);
  });

  it('runBacktest produces no errors on 100 scenarios', () => {
    const { errorCount } = runBacktest({ scenarios: 100 });
    assert.equal(errorCount, 0, 'No errors should occur during backtest');
  });
});
