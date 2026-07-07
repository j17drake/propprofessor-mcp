'use strict';

/**
 * WNBA screen fixture for agent-consistency tests.
 * One game, two teams, 5 books — models a TIER 1 BET play with a team
 * selection (so gameContextFn routing is exercised, not the player stub).
 */

const NOW = Date.now();
function isoAgo(ms) {
  return new Date(NOW - ms).toISOString();
}

const WNBA_MONEYLINE_LITE_PAYLOAD = {
  gameId: 'wnba-20260706-gsv-was',
  league: 'WNBA',
  market: 'Moneyline',
  updatedAt: isoAgo(30_000),
  homeTeam: 'Golden State Valkyries',
  awayTeam: 'Washington Mystics',
  selections: {
    ml: {
      selection1: 'Golden State Valkyries',
      participant1: 'Golden State Valkyries',
      selection1Id: 'Moneyline:Golden_State_Valkyries',
      selection2: 'Washington Mystics',
      participant2: 'Washington Mystics',
      participant2Id: 'Moneyline:Washington_Mystics',
      odds: {
        NoVigApp: { odds1: -203, odds2: 170 },
        Pinnacle: { odds1: -205, odds2: 172 },
        Circa: { odds1: -200, odds2: 168 },
        BetOnline: { odds1: -208, odds2: 175 },
        BookMaker: { odds1: -202, odds2: 169 }
      }
    }
  },
  defaultKey: 'ml'
};

module.exports = { WNBA_MONEYLINE_LITE_PAYLOAD };
