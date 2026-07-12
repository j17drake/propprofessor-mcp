'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');

describe('ask() executes the suggested tool, not just suggests it', () => {
  let callCount = { quick_screen: 0, validate_play: 0, player_context: 0, recommended_bets: 0 };

  function makeHandlers() {
    callCount = { quick_screen: 0, validate_play: 0, player_context: 0, recommended_bets: 0 };
    const handlers = createMcpHandlers({ client: {} });
    // Stub the relevant tools so the test doesn't hit the live API
    handlers.quick_screen = async (args) => {
      callCount.quick_screen++;
      return { ok: true, results: [{ league: args.leagues?.[0] || 'NBA', market: 'Moneyline', candidates: [{ game: 'G', selection: 'A', odds: -110, confidenceTier: 'TIER 1', kaiCall: 'BET' }] }] };
    };
    handlers.validate_play = async (args) => {
      callCount.validate_play++;
      return { ok: true, verdict: 'BET', tier: 'TIER 1', play: { odds: -110 } };
    };
    handlers.player_context = async (args) => {
      callCount.player_context++;
      return { ok: true, player: args.player, riskFlag: 'low' };
    };
    handlers.recommended_bets = async (args) => {
      callCount.recommended_bets++;
      return { ok: true, count: 2, plays: [] };
    };
    return handlers;
  }

  it('"best WNBA play on NoVigApp" actually invokes quick_screen and returns its result', async () => {
    const handlers = makeHandlers();
    const r = await handlers.ask({ query: 'best WNBA play on NoVigApp' });
    assert.equal(r.ok, true);
    assert.equal(callCount.quick_screen, 1, 'quick_screen should have been called');
    assert.equal(callCount.validate_play, 0, 'validate_play should NOT have been called');
    // The executed tool's result must be present
    assert.ok(r.result, 'executed tool result must be present');
    assert.ok(r.result.results, 'quick_screen result structure preserved');
    // suggestedTool still present for debuggability
    assert.equal(r.suggestedTool?.tool, 'quick_screen');
  });

  it('"should I bet Tatum" invokes validate_play, not quick_screen', async () => {
    const handlers = makeHandlers();
    const r = await handlers.ask({ query: 'should I bet Tatum over 29.5' });
    assert.equal(r.ok, true);
    assert.equal(callCount.validate_play, 1, 'validate_play should be called for "should I bet"');
    assert.equal(callCount.quick_screen, 0, 'quick_screen should NOT be called');
    assert.equal(r.result.verdict, 'BET');
  });

  it('player-only query (no book) invokes player_context', async () => {
    const handlers = makeHandlers();
    const r = await handlers.ask({ query: 'injury news for Tatum' });
    assert.equal(r.ok, true);
    assert.equal(callCount.player_context, 1, 'player_context should be called when only a player is mentioned');
    assert.ok(r.result.player);
  });

  it('no book + no player + no validation falls through to recommended_bets', async () => {
    const handlers = makeHandlers();
    const r = await handlers.ask({ query: 'what is sharp today' });
    assert.equal(r.ok, true);
    assert.equal(callCount.recommended_bets, 1);
  });

  it('missing query throws MISSING_PARAMS (preserves existing contract)', async () => {
    const handlers = makeHandlers();
    await assert.rejects(
      handlers.ask({}),
      (err) => err.code === 'MISSING_PARAMS'
    );
  });
});
