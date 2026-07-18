'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { parseNaturalLanguagePropQuery } = require('../lib/propprofessor-query-parser');

describe('ask() parses queries and suggests tools — parse-only, no execution', () => {

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

  describe('ask() - route suggestion tests (parse-only)', () => {
    function makeHandlers() {
      const handlers = createMcpHandlers({ client: {} });
      return handlers;
    }

    it('"best WNBA play on NoVigApp" suggests quick_screen with book', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'best WNBA play on NoVigApp' });
      assert.equal(result.ok, true);
      assert.equal(result.suggestedTool.tool, 'quick_screen');
      assert.deepStrictEqual(result.suggestedTool.args.books, ['NoVigApp']);
      assert.equal(result.parsed.book, 'NoVigApp');
      assert.equal(result.parsed.league, 'WNBA');
      // Parse-only: no result field
      assert.equal(result.result, undefined, 'should NOT auto-execute');
    });

    it('"should I bet Tatum" suggests validate_play', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'should I bet Tatum over 29.5' });
      assert.equal(result.ok, true);
      assert.equal(result.suggestedTool.tool, 'validate_play');
      assert.equal(result.suggestedTool.args.selection, 'Tatum');
      assert.equal(result.parsed.player, 'Tatum');
      assert.equal(result.result, undefined, 'should NOT auto-execute');
    });

    it('player-only query (Tatum over 29.5, no book) suggests player_context', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'Tatum over 29.5' });
      assert.equal(result.ok, true);
      assert.equal(result.suggestedTool.tool, 'player_context');
      assert.equal(result.suggestedTool.args.player, 'Tatum');
      assert.equal(result.result, undefined, 'should NOT auto-execute');
    });

    it('no book + no player + no validation suggests quick_screen in recommended mode', async () => {
      const handlers = makeHandlers();
      const result = await handlers.ask({ query: 'what is sharp today' });
      assert.equal(result.ok, true);
      assert.equal(result.suggestedTool.tool, 'quick_screen');
      assert.equal(result.suggestedTool.args.mode, 'recommended');
      assert.equal(result.result, undefined, 'should NOT auto-execute');
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
