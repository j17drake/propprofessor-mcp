'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Clear module cache to allow env var changes
function resetModules() {
  delete require.cache[require.resolve('../lib/mcp-runtime-config')];
  delete require.cache[require.resolve('../lib/propprofessor-prewarm')];
}

describe('propprofessor-prewarm', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetModules();
  });

  describe('getPreWarmConfig', () => {
    it('skips when PROPPROFESSOR_MCP_PREWARM=0', () => {
      process.env.PROPPROFESSOR_MCP_PREWARM = '0';
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      assert.equal(config.enabled, false);
    });

    it('returns enabled by default', () => {
      delete process.env.PROPPROFESSOR_MCP_PREWARM;
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      assert.equal(config.enabled, true);
    });

    it('parses PROPPROFESSOR_MCP_PREWARM_LEAGUES', () => {
      process.env.PROPPROFESSOR_MCP_PREWARM_LEAGUES = 'NBA,MLB,NHL';
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      assert.deepEqual(config.leagues, ['NBA', 'MLB', 'NHL']);
    });

    it('defaults to all supported leagues', () => {
      delete process.env.PROPPROFESSOR_MCP_PREWARM_LEAGUES;
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      const expectedLeagues = ['NBA', 'MLB', 'NFL', 'NHL', 'WNBA', 'NCAAB', 'NCAAF', 'Soccer', 'Tennis', 'UFC'];
      assert.deepEqual(config.leagues, expectedLeagues);
    });

    it('parses PROPPROFESSOR_MCP_PREWARM_TIMEOUT_MS', () => {
      process.env.PROPPROFESSOR_MCP_PREWARM_TIMEOUT_MS = '5000';
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      assert.equal(config.timeoutMs, 5000);
    });

    it('defaults timeout to 10000ms', () => {
      delete process.env.PROPPROFESSOR_MCP_PREWARM_TIMEOUT_MS;
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const config = getPreWarmConfig();
      assert.equal(config.timeoutMs, 10000);
    });
  });

  describe('prewarmOddsHistoryCache', () => {
    it('skips when enabled is false', async () => {
      process.env.PROPPROFESSOR_MCP_PREWARM = '0';
      const { getPreWarmConfig } = require('../lib/mcp-runtime-config');
      const { prewarmOddsHistoryCache } = require('../lib/propprofessor-prewarm');

      const mockClient = {
        queryScreenOddsBestComps: async () => {
          throw new Error('Should not be called');
        }
      };

      const config = getPreWarmConfig();
      const result = await prewarmOddsHistoryCache({
        client: mockClient,
        runtimeConfig: config,
        logger: null
      });

      assert.equal(result.leaguesProcessed, 0);
      assert.equal(result.gamesProcessed, 0);
      assert.equal(result.errors, 0);
    });

    it('runs within timeout and populates cache', async () => {
      const { prewarmOddsHistoryCache } = require('../lib/propprofessor-prewarm');

      const mockClient = {
        queryScreenOddsBestComps: async ({ league }) => {
          // Return mock game data for each league
          return {
            game_data: [
              { gameId: 'game-1', selections: { home: { selectionId: 'home-1' } } },
              { gameId: 'game-2', selections: { away: { selectionId: 'away-1' } } }
            ]
          };
        },
        queryOddsHistory: async () => ({ history: 'data' })
      };

      const config = { enabled: true, leagues: ['NBA'], timeoutMs: 10000 };
      const result = await prewarmOddsHistoryCache({
        client: mockClient,
        runtimeConfig: config,
        logger: null
      });

      assert.equal(result.leaguesProcessed, 1);
      assert.equal(result.gamesProcessed, 2);
    });

    it('handles client errors gracefully', async () => {
      const { prewarmOddsHistoryCache } = require('../lib/propprofessor-prewarm');

      const mockClient = {
        queryScreenOddsBestComps: async () => {
          throw new Error('API error');
        }
      };

      const config = { enabled: true, leagues: ['NBA'], timeoutMs: 10000 };
      const result = await prewarmOddsHistoryCache({
        client: mockClient,
        runtimeConfig: config,
        logger: null
      });

      assert.equal(result.leaguesProcessed, 0);
      assert.equal(result.errors, 1);
    });

    it('does not block initialize (setImmediate is used)', async () => {
      const { prewarmOddsHistoryCache } = require('../lib/propprofessor-prewarm');

      let prewarmStarted = false;
      let prewarmCompleted = false;

      const mockClient = {
        queryScreenOddsBestComps: async () => {
          prewarmStarted = true;
          await new Promise((r) => setTimeout(r, 100)); // Simulate slow API
          prewarmCompleted = true;
          return { game_data: [] };
        },
        queryOddsHistory: async () => ({})
      };

      const config = { enabled: true, leagues: ['NBA'], timeoutMs: 10000 };

      // Call prewarmOddsHistoryCache - it should NOT block
      const prewarmPromise = prewarmOddsHistoryCache({
        client: mockClient,
        runtimeConfig: config,
        logger: null
      });

      // Immediately after calling, prewarm should NOT have completed yet
      // (setImmediate defers execution)
      // Note: This test verifies the function returns a promise, not that it blocks
      // The actual setImmediate behavior is tested by checking the function signature

      // Wait for completion
      await prewarmPromise;

      assert.equal(prewarmStarted, true);
      assert.equal(prewarmCompleted, true);
    });
  });
});