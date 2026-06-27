'use strict';

/**
 * Per-league sharp book weights.
 *
 * Weights are derived from the synthetic backtest: for each (league, book)
 * pair, the weight represents how much more (or less) predictive that book's
 * movement is vs the league average.
 *
 * Weight 1.0 = neutral. 1.5 = 50% more predictive. 0.7 = 30% less predictive.
 *
 * Updated manually as real resolution data accumulates from the pick tracker.
 */

const LEAGUE_BOOK_WEIGHTS = {
  NBA: {
    Pinnacle: 1.2,
    Circa: 1.1,
    BookMaker: 0.9,
    BetOnline: 0.8
  },
  MLB: {
    Pinnacle: 1.3,
    Circa: 1.0,
    BookMaker: 0.9,
    BetOnline: 0.9
  },
  NFL: {
    Pinnacle: 1.4,
    Circa: 1.2,
    BookMaker: 1.0,
    BetOnline: 0.9
  },
  NHL: {
    Pinnacle: 1.1,
    Circa: 1.0,
    BookMaker: 0.9,
    BetOnline: 1.0
  }
};

/**
 * Get the weight multiplier for a sharp book in a specific league.
 * @param {string} league - League name (e.g. 'NBA')
 * @param {string} book - Sharp book name (e.g. 'Pinnacle')
 * @returns {number} Weight multiplier (default 1.0)
 */
function getSharpBookWeight(league, book) {
  const leagueWeights = LEAGUE_BOOK_WEIGHTS[league];
  if (!leagueWeights) return 1.0;
  return typeof leagueWeights[book] === 'number' ? leagueWeights[book] : 1.0;
}

module.exports = { getSharpBookWeight, LEAGUE_BOOK_WEIGHTS };
