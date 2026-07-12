'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { parseNaturalLanguagePropQuery } = require('../lib/propprofessor-query-parser');

describe('ask() executes the suggested tool, not just suggests it', () => {

  describe('ask() - query extraction tests', () => {
    it('"best WNBA play on NoVigApp" extracts player and book', async () => {
      const parsed = parseNaturalLanguagePropQuery('best WNBA play on NoVigApp');
      assert.equal(parsed.book, 'NoVigApp');
      assert.equal(parsed.league, 'WNBA');
      assert.equal(parsed.player, null);
    });
    
    it('"should I bet Tatum over 29.5" extracts player for validation', async () => {
      const parsed = parseNaturalLanguagePropQuery('should I bet Tatum over 29.5');
      assert.equal(parsed.player, 'Tatum');
      assert.equal(parsed.line, 29.5);
      assert.equal(parsed.side, 'over');
    });
    
    it('"Tatum over 29.5" (player, no book, no validation word) routes to player_context', async () => {
      const parsed = parseNaturalLanguagePropQuery('Tatum over 29.5');
      assert.equal(parsed.player, 'Tatum');
      assert.equal(parsed.book, null);
    });
    
    it('"what is sharp today" extracts no key fields', async () => {
      const parsed = parseNaturalLanguagePropQuery('what is sharp today');
      assert.equal(parsed.player, null);
      assert.equal(parsed.book, null);
      assert.equal(parsed.league, null);
      assert.equal(parsed.market, null);
    });
  });

  describe('ask() - route execution tests', () => {
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
      const result = await handlers.ask({ query: 'best WNBA play on NoVigApp' });
      assert.equal(result.ok, true);
      assert.equal(callCount.quick_screen, 1, 'quick_screen should have been called');
      assert.equal(callCount.validate_play, 0, 'validate_play should NOT have been called');
      assert.ok(result.result?.results, 'should contain quick_screen result');
      assert.equal(result.suggestedTool?.tool, 'quick_screen');
    });

    it('"should I bet Tatum" invokes validate_play, not quick_screen', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'should I bet Tatum over 29.5' });
      assert.equal(result.ok, true);
      assert.equal(callCount.validate_play, 1, 'validate_play should be called');
      assert.equal(callCount.quick_screen, 0, 'quick_screen should NOT be called');
      assert.equal(callCount.player_context, 0, 'player_context should NOT be called');
      assert.equal(result.result.verdict, 'BET');
    });

    it('player-only query (Tatum over 29.5, no book) invokes player_context', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'Tatum over 29.5' });
      assert.equal(result.ok, true);
      assert.equal(callCount.player_context, 1, 'player_context should be called');
      assert.ok(result.result.player);
      assert.equal(result.suggestedTool?.tool, 'player_context');
    });

    it('no book + no player + no validation falls through to recommended_bets', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'what is sharp today' });
      assert.equal(result.ok, true);
      assert.equal(callCount.recommended_bets, 1);
      assert.equal(result.suggestedTool?.tool, 'recommended_bets');
    });

    it('missing query throws MISSING_PARAMS (preserves existing contract)', async () => {
      const handlers = makeHandlers();
      await assert.rejects(
        handlers.ask({}),
        (err) => err.code === 'MISSING_PARAMS'
      );
    });
  });
});
