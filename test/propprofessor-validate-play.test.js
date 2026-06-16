'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');

function makeClient({
  detailRows: _detailRows = [],
  research: _research = null,
  detailError: _detailError = null
} = {}) {
  return {
    queryScreenOddsBestComps: async () => ({
      game_data: [
        {
          gameId: 'NBA:game-1',
          league: 'NBA',
          market: 'Moneyline',
          updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
          homeTeam: 'Lakers',
          awayTeam: 'Warriors',
          selections: {
            a: {
              selection1: 'Lakers',
              participant1: 'Lakers',
              selection1Id: 'Moneyline:Lakers',
              selection2: 'Warriors',
              participant2: 'Warriors',
              selection2Id: 'Moneyline:Warriors',
              odds: {
                NoVigApp: { odds1: -118, odds2: 104 },
                Pinnacle: { odds1: -120, odds2: 106 }
              }
            }
          },
          defaultKey: 'a'
        }
      ]
    }),
    queryOddsHistory: async () => ({
      NoVigApp: [
        { odds: -118, start_ts: 1 },
        { odds: -130, start_ts: 2 }
      ]
    })
  };
}

describe('validate_play handler', () => {
  it('returns VALIDATION_ERROR when league is missing', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    const result = await handlers.validate_play({ gameId: 'NBA:game-1', selection: 'Lakers' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.match(result.error.message, /league/);
  });

  it('returns VALIDATION_ERROR when gameId is missing', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    const result = await handlers.validate_play({ league: 'NBA', selection: 'Lakers' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.match(result.error.message, /gameId/);
  });

  it('returns VALIDATION_ERROR when selection is missing', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    const result = await handlers.validate_play({ league: 'NBA', gameId: 'NBA:game-1' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VALIDATION_ERROR');
    assert.match(result.error.message, /selection/);
  });

  it('skips research when skipResearch=true and returns verdict', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    // Replace player_context to detect if it gets called
    let researchCalled = false;
    handlers.player_context = async () => {
      researchCalled = true;
      return { riskFlag: 'low', tweets: [], news: [] };
    };
    const result = await handlers.validate_play({
      league: 'NBA',
      gameId: 'NBA:game-1',
      selection: 'Lakers',
      skipResearch: true
    });
    assert.equal(result.ok, true);
    assert.equal(researchCalled, false, 'player_context should not be called when skipResearch=true');
    assert.equal(result.research.skipped, true);
    // Verdict is at least PASS or CONSIDER or BET
    assert.ok(['PASS', 'CONSIDER', 'BET'].includes(result.verdict));
  });

  it('downgrades verdict to PASS when riskFlag is "high"', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    handlers.player_context = async () => ({
      riskFlag: 'high',
      summary: 'Injury news confirmed',
      tweets: [{ text: 'OUT tonight' }],
      news: [],
      cached: false
    });
    const result = await handlers.validate_play({
      league: 'NBA',
      gameId: 'NBA:game-1',
      selection: 'Lakers',
      book: 'NoVigApp'
    });
    assert.equal(result.ok, true);
    // The verdict should be downgraded to PASS when riskFlag is high,
    // even if the underlying row is otherwise BET/CONSIDER.
    assert.equal(result.verdict, 'PASS', 'verdict should be PASS when riskFlag=high');
    assert.ok(
      result.reasons.some((r) => /high/.test(r)),
      'should mention high risk in reasons'
    );
    assert.equal(result.research.riskFlag, 'high');
  });

  it('downgrades BET to CONSIDER when riskFlag is "medium"', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    handlers.player_context = async () => ({
      riskFlag: 'medium',
      summary: 'Some concern',
      tweets: [],
      news: [],
      cached: true
    });
    const result = await handlers.validate_play({
      league: 'NBA',
      gameId: 'NBA:game-1',
      selection: 'Lakers'
    });
    assert.equal(result.ok, true);
    // Verdict can be at most CONSIDER when riskFlag=medium.
    assert.ok(['PASS', 'CONSIDER'].includes(result.verdict), 'verdict should be PASS or CONSIDER');
    if (result.verdict === 'CONSIDER') {
      assert.ok(result.reasons.some((r) => /medium/.test(r)));
    }
  });

  it('returns PASS verdict when no row matches the selection', async () => {
    const handlers = createMcpHandlers({ client: makeClient() });
    handlers.player_context = async () => ({ riskFlag: 'low', tweets: [], news: [] });
    const result = await handlers.validate_play({
      league: 'NBA',
      gameId: 'NBA:game-1',
      selection: 'Nonexistent Player'
    });
    assert.equal(result.ok, true);
    assert.equal(result.play, null);
    assert.equal(result.verdict, 'PASS');
    assert.ok(result.reasons.some((r) => /no row matched/.test(r)));
  });
});
