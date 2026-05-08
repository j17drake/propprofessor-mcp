'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getCommandInventory, main, parseArgs, resolveScreenCommand } = require('../scripts/query-propprofessor');

describe('query-propprofessor CLI parsing', () => {
  it('accepts lookback-hours aliases', () => {
    const dashed = parseArgs(['node', 'query', 'screen', '--lookback-hours', '4']);
    assert.equal(dashed.command, 'screen');
    assert.equal(dashed.opts.lookbackHours, '4');

    const camel = parseArgs(['node', 'query', 'screen', '--lookbackHours', '8']);
    assert.equal(camel.command, 'screen');
    assert.equal(camel.opts.lookbackHours, '8');
  });

  it('accepts debug flags', () => {
    const enabled = parseArgs(['node', 'query', 'screen', '--debug']);
    assert.equal(enabled.opts.debug, true);

    const disabled = parseArgs(['node', 'query', 'screen', '--no-debug']);
    assert.equal(disabled.opts.debug, false);
  });

  it('accepts positive EV discovery flags', () => {
    const parsed = parseArgs([
      'node', 'query', 'sportsbook',
      '--league', 'NBA',
      '--books', 'Fliff,NoVigApp',
      '--market', 'Player Props',
      '--line', '-3'
    ]);

    assert.equal(parsed.command, 'sportsbook');
    assert.equal(parsed.opts.league, 'NBA');
    assert.equal(parsed.opts.books, 'Fliff,NoVigApp');
    assert.equal(parsed.opts.market, 'Player Props');
    assert.equal(parsed.opts.line, '-3');
  });

  it('resolves documented screen aliases to supported leagues', () => {
    assert.deepEqual(resolveScreenCommand('sport', { league: 'WNBA' }), { command: 'screen', league: 'WNBA' });
    assert.deepEqual(resolveScreenCommand('nba', {}), { command: 'screen', league: 'NBA' });
    assert.deepEqual(resolveScreenCommand('wnba', {}), { command: 'screen', league: 'WNBA' });
    assert.deepEqual(resolveScreenCommand('soccer', {}), { command: 'screen', league: 'Soccer' });
  });

  it('exposes the documented command inventory', () => {
    const inventory = getCommandInventory().map(entry => entry.command);
    assert.deepEqual(inventory, [
      'opinion',
      'sportsbook',
      'smart',
      'tennis',
      'screen',
      'sport',
      'nba',
      'wnba',
      'mlb',
      'nfl',
      'nhl',
      'soccer',
      'ncaab',
      'ncaaf',
      'presets',
      'list',
      'health'
    ]);
  });
});

describe('query-propprofessor CLI command execution', () => {
  function createLogger() {
    const lines = [];
    return {
      logger: {
        log(value) {
          lines.push(String(value));
        }
      },
      lines
    };
  }

  it('renders presets without throwing and includes WNBA', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'presets'],
      client: {},
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'presets');
    assert.ok(Array.isArray(payload.presets));
    assert.ok(payload.presets.some(entry => entry.league === 'WNBA'));
  });

  it('renders the command list locally', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'list'],
      client: {},
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'list');
    assert.ok(Array.isArray(payload.commands));
    assert.ok(payload.commands.some(entry => entry.command === 'sport'));
  });

  it('routes the sport alias through screen ranking with the requested league', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: ['node', 'query', 'sport', '--league', 'WNBA', '--market', 'Moneyline'],
      client: {
        queryScreenOddsBestComps: async filters => {
          calls.push(filters);
          return { game_data: [] };
        }
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'WNBA');
    assert.equal(payload.league, 'WNBA');
  });

  it('routes the nba shorthand alias through screen ranking', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: ['node', 'query', 'nba', '--market', 'Moneyline'],
      client: {
        queryScreenOddsBestComps: async filters => {
          calls.push(filters);
          return { game_data: [] };
        }
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'NBA');
    assert.equal(payload.league, 'NBA');
  });

  for (const [command, expectedLeague] of [
    ['wnba', 'WNBA'],
    ['mlb', 'MLB'],
    ['nfl', 'NFL'],
    ['nhl', 'NHL'],
    ['soccer', 'Soccer'],
    ['ncaab', 'NCAAB'],
    ['ncaaf', 'NCAAF']
  ]) {
    it(`smoke-routes ${command} through screen ranking`, async () => {
      const { logger, lines } = createLogger();
      const calls = [];

      await main({
        argv: ['node', 'query', command, '--market', 'Moneyline'],
        client: {
          queryScreenOddsBestComps: async filters => {
            calls.push(filters);
            return { game_data: [] };
          }
        },
        logger
      });

      const payload = JSON.parse(lines[0]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].league, expectedLeague);
      assert.equal(payload.league, expectedLeague);
    });
  }

  it('smoke-runs the documented health command', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'health'],
      client: {
        healthStatus: async () => ({ ok: true, endpoints: { screen: 'ok' } })
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'health');
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.endpoints, { screen: 'ok' });
  });

  it('smoke-runs the documented sportsbook and smart commands', async () => {
    const sportsbook = createLogger();
    await main({
      argv: ['node', 'query', 'sportsbook'],
      client: {
        querySportsbook: async () => ([{ player: 'A' }])
      },
      logger: sportsbook.logger
    });
    const sportsbookPayload = JSON.parse(sportsbook.lines[0]);
    assert.equal(sportsbookPayload.command, 'sportsbook');
    assert.equal(sportsbookPayload.count, 1);

    const smart = createLogger();
    await main({
      argv: ['node', 'query', 'smart'],
      client: {
        querySmartMoney: async () => ([{ player: 'B' }])
      },
      logger: smart.logger
    });
    const smartPayload = JSON.parse(smart.lines[0]);
    assert.equal(smartPayload.command, 'smart');
    assert.equal(smartPayload.count, 1);
  });

  it('expands tennis market aliases the same way as MCP tennis queries', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: ['node', 'query', 'tennis', '--market', 'Spread'],
      client: {
        queryScreenOdds: async filters => {
          calls.push(filters);
          return { game_data: [] };
        }
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.market), ['Game Handicap', 'Set Handicap', 'Point Spread']);
    assert.equal(payload.league, 'Tennis');
  });
});
