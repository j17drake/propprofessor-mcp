'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildDoctorReport,
  buildHelpText,
  buildInstallAuthReport,
  getCommandInventory,
  main,
  parseArgs,
  resolveScreenCommand
} = require('../scripts/query-propprofessor');

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
      'node',
      'query',
      'sportsbook',
      '--league',
      'NBA',
      '--books',
      'Fliff,NoVigApp',
      '--market',
      'Player Props',
      '--line',
      '-3'
    ]);

    assert.equal(parsed.command, 'sportsbook');
    assert.equal(parsed.opts.league, 'NBA');
    assert.equal(parsed.opts.books, 'Fliff,NoVigApp');
    assert.equal(parsed.opts.market, 'Player Props');
    assert.equal(parsed.opts.line, '-3');
  });

  it('accepts dedicated UFC card aliases and flags', () => {
    const parsed = parseArgs([
      'node',
      'query',
      'ufc-card',
      '--target-book',
      'NoVigApp',
      '--markets',
      'Moneyline,Total',
      '--event-date',
      '2026-05-10',
      '--card-window',
      'today',
      '--upcoming-only',
      '--max-hours-away',
      '24',
      '--scan-limit',
      '10'
    ]);

    assert.equal(parsed.command, 'ufc-card');
    assert.equal(parsed.opts.book, 'NoVigApp');
    assert.equal(parsed.opts.targetBook, 'NoVigApp');
    assert.equal(parsed.opts.market, 'Moneyline,Total');
    assert.equal(parsed.opts.markets, 'Moneyline,Total');
    assert.equal(parsed.opts.eventDate, '2026-05-10');
    assert.equal(parsed.opts.cardWindow, 'today');
    assert.equal(parsed.opts.upcomingOnly, true);
    assert.equal(parsed.opts.maxHoursAway, '24');
    assert.equal(parsed.opts.scanLimit, '10');
  });

  it('resolves documented screen aliases to supported leagues', () => {
    assert.deepEqual(resolveScreenCommand('sport', { league: 'WNBA' }), { command: 'screen', league: 'WNBA' });
    assert.deepEqual(resolveScreenCommand('nba', {}), { command: 'screen', league: 'NBA' });
    assert.deepEqual(resolveScreenCommand('wnba', {}), { command: 'screen', league: 'WNBA' });
    assert.deepEqual(resolveScreenCommand('ufc', {}), { command: 'screen', league: 'UFC' });
    assert.deepEqual(resolveScreenCommand('mma', {}), { command: 'screen', league: 'UFC' });
    assert.deepEqual(resolveScreenCommand('soccer', {}), { command: 'screen', league: 'Soccer' });
  });

  it('exposes the documented command inventory', () => {
    const inventory = getCommandInventory().map((entry) => entry.command);
    assert.deepEqual(inventory, [
      'opinion',
      'sportsbook',
      'smart',
      'tennis',
      'sharp-plays',
      'screen',
      'sport',
      'nba',
      'wnba',
      'mlb',
      'nfl',
      'nhl',
      'ufc',
      'ufc-card',
      'mma',
      'soccer',
      'ncaab',
      'ncaaf',
      'presets',
      'list',
      'health',
      'doctor',
      'install-auth',
      'stats',
      'calibration'
    ]);
  });

  it('prints beginner-friendly help text', () => {
    const help = buildHelpText();
    assert.match(help, /Start here:/);
    assert.match(help, /install-auth/);
    assert.match(help, /pp-query doctor/);
    assert.match(help, /pp-query ufc-card/);
    assert.match(help, /Auth file lookup order:/);
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
    assert.ok(payload.presets.some((entry) => entry.league === 'WNBA'));
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
    assert.ok(payload.commands.some((entry) => entry.command === 'sport'));
  });

  it('routes the sport alias through screen ranking with the requested league', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: ['node', 'query', 'sport', '--league', 'WNBA', '--market', 'Moneyline'],
      client: {
        queryScreenOddsBestComps: async (filters) => {
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

  it('routes ufc-card through ufc_card with UFC card flags', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: [
        'node',
        'query',
        'ufc-card',
        '--book',
        'NoVigApp',
        '--markets',
        'Moneyline,Total',
        '--eventDate',
        '2026-05-10',
        '--cardWindow',
        'today',
        '--upcomingOnly',
        '--maxHoursAway',
        '48',
        '--limit',
        '5',
        '--scanLimit',
        '10',
        '--debug',
        '--live',
        '--json'
      ],
      client: {
        queryScreenOddsBestComps: async (filters) => {
          calls.push(filters);
          return { game_data: [] };
        }
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'UFC');
    assert.equal(calls[0].market, 'Moneyline');
    assert.equal(calls[0].is_live, true);
    assert.equal(payload.league, 'UFC');
    assert.ok(Array.isArray(payload.officialPlays));
  });

  it('renders concise UFC output for non-json command output', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'ufc-card'],
      client: {
        queryScreenOddsBestComps: async () => ({ game_data: [] })
      },
      logger
    });

    const output = lines.join('\n');
    assert.match(output, /Official UFC bets/);
    assert.match(output, /Best UFC looks/);
    assert.match(output, /Passes/);
    assert.match(output, /Summary/);
  });

  it('preserves structured payloads when json output is requested for ufc-card', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'ufc-card', '--json'],
      client: {
        queryScreenOddsBestComps: async () => ({ game_data: [] })
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.ok, true);
    assert.equal(payload.league, 'UFC');
    assert.ok(Array.isArray(payload.officialPlays));
    assert.ok(Array.isArray(payload.bestLooks));
    assert.ok(Array.isArray(payload.passes));
    assert.equal(payload.resultMeta.source, 'ufc_card');
  });

  it('routes the nba shorthand alias through screen ranking', async () => {
    const { logger, lines } = createLogger();
    const calls = [];

    await main({
      argv: ['node', 'query', 'nba', '--market', 'Moneyline'],
      client: {
        queryScreenOddsBestComps: async (filters) => {
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
    ['ufc', 'UFC'],
    ['mma', 'UFC'],
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
          queryScreenOddsBestComps: async (filters) => {
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

  it('smoke-runs the doctor command and reports success when health passes', async () => {
    const { logger, lines } = createLogger();

    await main({
      argv: ['node', 'query', 'doctor'],
      client: {
        healthStatus: async () => ({ ok: true, endpoints: { screen: 'ok' } })
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'doctor');
    assert.equal(typeof payload.checks.auth.selectedAuthFile, 'string');
    assert.equal(payload.summary.endpoint, 'ok');
  });

  it('smoke-runs the install-auth command and copies a source file', async () => {
    const { logger, lines } = createLogger();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-install-auth-'));
    const sourceFile = path.join(tempDir, 'source-auth.json');
    const destinationFile = path.join(tempDir, '.propprofessor', 'auth.json');
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({ cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'abc' }] }),
      'utf8'
    );

    try {
      await main({
        argv: ['node', 'query', 'install-auth', '--source', sourceFile, '--destination', destinationFile],
        client: {},
        logger
      });

      const payload = JSON.parse(lines[0]);
      assert.equal(payload.command, 'install-auth');
      assert.equal(payload.ok, true);
      assert.equal(fs.existsSync(destinationFile), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('smoke-runs the documented sportsbook and smart commands', async () => {
    const sportsbook = createLogger();
    await main({
      argv: ['node', 'query', 'sportsbook'],
      client: {
        querySportsbook: async () => [{ player: 'A' }]
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
        querySmartMoney: async () => [{ player: 'B' }]
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
        queryScreenOdds: async (filters) => {
          calls.push(filters);
          return { game_data: [] };
        }
      },
      logger
    });

    const payload = JSON.parse(lines[0]);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((call) => call.market),
      ['Game Handicap', 'Set Handicap', 'Point Spread']
    );
    assert.equal(payload.league, 'Tennis');
  });

  it('builds a doctor report with a clear next step when endpoint health fails', () => {
    const report = buildDoctorReport({ ok: false, error: 'boom' });
    assert.equal(report.command, 'doctor');
    assert.equal(report.summary.endpoint, 'error');
    assert.equal(typeof report.nextStep, 'string');
  });

  it('builds an install-auth report with a follow-up step', () => {
    const report = buildInstallAuthReport({
      sourceFile: '/tmp/source.json',
      destinationFile: '/tmp/auth.json',
      usedExistingFile: false
    });
    assert.equal(report.command, 'install-auth');
    assert.equal(report.ok, true);
    assert.match(report.nextStep, /pp-query doctor/);
  });

  it('accepts --group-by and --since flags', () => {
    const parsed = parseArgs(['node', 'query', 'stats', '--group-by', 'league,book', '--since', '2026-01-01']);
    assert.equal(parsed.command, 'stats');
    assert.equal(parsed.opts.groupBy, 'league,book');
    assert.equal(parsed.opts.since, '2026-01-01');
  });

  it('accepts --days flag', () => {
    const parsed = parseArgs(['node', 'query', 'calibration', '--days', '30']);
    assert.equal(parsed.command, 'calibration');
    assert.equal(parsed.opts.days, '30');
  });

  it('smoke-runs the stats command with no events', async () => {
    const { logger, lines } = createLogger();
    await main({
      argv: ['node', 'query', 'stats', '--group-by', 'league'],
      client: {},
      logger
    });
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'stats');
    assert.equal(payload.total, 0);
    assert.ok(Array.isArray(payload.groups.league));
    assert.ok(payload.generatedAt);
  });

  it('smoke-runs the calibration command with no outcomes', async () => {
    const { logger, lines } = createLogger();
    await main({
      argv: ['node', 'query', 'calibration', '--days', '30'],
      client: {},
      logger
    });
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.command, 'calibration');
    assert.equal(payload.totalOutcomes, 0);
    assert.ok(Array.isArray(payload.byTier));
    assert.ok(Array.isArray(payload.byLeague));
    assert.ok(payload.generatedAt);
  });

  it('stats returns grouped results from seeded memory events', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-stats-'));
    const memoryFile = path.join(tempDir, 'events.jsonl');
    const events = [
      { ts: '2026-06-01T00:00:00Z', type: 'outcome', source: 'manual', league: 'NBA', tier: 'TIER 1', outcome: 'win', profit: 50 },
      { ts: '2026-06-02T00:00:00Z', type: 'outcome', source: 'manual', league: 'NBA', tier: 'TIER 2', outcome: 'loss', profit: -25 },
      { ts: '2026-06-03T00:00:00Z', type: 'outcome', source: 'manual', league: 'MLB', tier: 'TIER 1', outcome: 'win', profit: 30 }
    ];
    fs.writeFileSync(memoryFile, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const origDir = process.env.PROPPROFESSOR_MEMORY_DIR;
    process.env.PROPPROFESSOR_MEMORY_DIR = tempDir;
    try {
      const { logger, lines } = createLogger();
      await main({
        argv: ['node', 'query', 'stats', '--group-by', 'league,tier'],
        client: {},
        logger
      });
      const payload = JSON.parse(lines[0]);
      assert.equal(payload.command, 'stats');
      assert.equal(payload.total, 3);
      assert.ok(payload.groups.league.some(g => g.key === 'NBA' && g.count === 2));
      assert.ok(payload.groups.league.some(g => g.key === 'MLB' && g.count === 1));
      assert.ok(payload.groups.tier.some(g => g.key === 'TIER 1' && g.wins === 2));
    } finally {
      if (origDir === undefined) delete process.env.PROPPROFESSOR_MEMORY_DIR;
      else process.env.PROPPROFESSOR_MEMORY_DIR = origDir;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('calibration returns hit-rate and roi from seeded outcomes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-cal-'));
    const memoryFile = path.join(tempDir, 'events.jsonl');
    const events = [
      { ts: '2026-06-01T00:00:00Z', type: 'outcome', source: 'manual', league: 'NBA', tier: 'TIER 1', outcome: 'win', profit: 50 },
      { ts: '2026-06-02T00:00:00Z', type: 'outcome', source: 'manual', league: 'NBA', tier: 'TIER 1', outcome: 'loss', profit: -25 },
      { ts: '2026-06-03T00:00:00Z', type: 'outcome', source: 'manual', league: 'NBA', tier: 'TIER 1', outcome: 'win', profit: 40 }
    ];
    fs.writeFileSync(memoryFile, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const origDir = process.env.PROPPROFESSOR_MEMORY_DIR;
    process.env.PROPPROFESSOR_MEMORY_DIR = tempDir;
    try {
      const { logger, lines } = createLogger();
      await main({
        argv: ['node', 'query', 'calibration'],
        client: {},
        logger
      });
      const payload = JSON.parse(lines[0]);
      assert.equal(payload.command, 'calibration');
      assert.equal(payload.totalOutcomes, 3);
      const t1 = payload.byTier.find(t => t.key === 'TIER 1');
      assert.equal(t1.count, 3);
      assert.equal(t1.wins, 2);
      assert.equal(t1.losses, 1);
      assert.equal(t1.hitRate, +(2 / 3 * 100).toFixed(1));
    } finally {
      if (origDir === undefined) delete process.env.PROPPROFESSOR_MEMORY_DIR;
      else process.env.PROPPROFESSOR_MEMORY_DIR = origDir;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
