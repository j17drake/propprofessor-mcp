#!/usr/bin/env node
'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_LEAGUES } = require('../lib/propprofessor-shared-utils');

const {
  createPropProfessorClient,
  DEFAULT_USER_AUTH_FILE,
  installAuthFile,
  inspectAuthSetup
} = require('../lib/propprofessor-api');
const { analyzePlayerPropBet } = require('../lib/propprofessor-analysis');
const { getLocalTimezone, getOddsHistoryLookbackHours } = require('../lib/mcp-runtime-config');
const { correctTennisTimes } = require('../lib/propprofessor-tennis');
const {
  rankTennisScreenRows,
  rankLeagueScreenRows,
  extractScreenRows,
  getLeagueRankingPreset,
  normalizeTennisMarketQuery
} = require('../lib/propprofessor-screen-utils');
const { buildRankedScreenResponse, getDebugFlag } = require('../lib/propprofessor-mcp-ranked-screen');
const { createMcpHandlers } = require('./propprofessor-mcp-server');

const LEAGUE_ALIASES = {
  sport: null,
  nba: 'NBA',
  wnba: 'WNBA',
  mlb: 'MLB',
  nfl: 'NFL',
  nhl: 'NHL',
  ufc: 'UFC',
  mma: 'UFC',
  soccer: 'Soccer',
  ncaab: 'NCAAB',
  ncaaf: 'NCAAF'
};

function getCommandInventory() {
  return [
    { command: 'setup', description: 'Install default config to ~/.propprofessor/config.json (idempotent)' },
    { command: 'opinion', description: 'Analyze a single prop from sportsbook rows' },
    { command: 'sportsbook', description: 'Fetch sportsbook +EV rows' },
    { command: 'smart', description: 'Fetch smart money rows' },
    { command: 'tennis', description: 'Query and rank tennis screen rows' },
    { command: 'sharp-plays', description: 'Scan target-book plays with supportive non-target sharp movement' },
    { command: 'screen', description: 'Query and rank any supported league screen with --league' },
    { command: 'sport', description: 'Alias for screen, use --league to pick the sport' },
    { command: 'nba', description: 'NBA screen shorthand' },
    { command: 'wnba', description: 'WNBA screen shorthand' },
    { command: 'mlb', description: 'MLB screen shorthand' },
    { command: 'nfl', description: 'NFL screen shorthand' },
    { command: 'nhl', description: 'NHL screen shorthand' },
    { command: 'ufc', description: 'UFC screen shorthand' },
    { command: 'ufc-card', description: 'Query a UFC card shortlist' },
    { command: 'mma', description: 'MMA alias for UFC screen shorthand' },
    { command: 'soccer', description: 'Soccer screen shorthand' },
    { command: 'ncaab', description: 'NCAAB screen shorthand' },
    { command: 'ncaaf', description: 'NCAAF screen shorthand' },
    { command: 'presets', description: 'Show active league ranking presets' },
    { command: 'exe', description: 'Display tier-ranked plays in a quick CLI view (pp-exe)' },
    { command: 'list', description: 'Show the command inventory' },
    { command: 'health', description: 'Check auth and endpoint health' },
    { command: 'doctor', description: 'Run first-time setup checks and explain next steps' },
    { command: 'install-auth', description: 'Copy a saved browser session into the default auth location' },
    {
      command: 'login',
      description: 'Open a browser to log in to PropProfessor and save auth automatically (requires playwright)'
    }
  ];
}

function buildHelpText() {
  return [
    'PropProfessor query CLI',
    '',
    'Start here:',
    '  pp-query login',
    '  pp-query doctor',
    '  pp-query health',
    '',
    'Common commands:',
    '  pp-query login                           # automated browser login (requires playwright)',
    '  pp-query install-auth --source /path/to/auth.json',
    '  pp-query doctor',
    '  pp-query health',
    '  pp-query screen --league NBA --market Moneyline',
    '  pp-query sharp-plays --book Fliff --leagues NBA,MLB,NHL,Tennis,WNBA,UFC --market Moneyline',
    '  pp-query nba --market Moneyline',
    '  pp-query ufc --market Moneyline',
    '  pp-query ufc-card --book NoVigApp --market Moneyline',
    '  pp-query tennis --market Moneyline --limit 10',
    '  pp-query exe                             # display tier-ranked plays',
    '',
    'Useful flags:',
    '  --league NBA',
    '  --market Moneyline',
    '  --books NoVigApp,Polymarket',
    '  --lookback-hours 6',
    '  --limit 10',
    '  --verbosity minimal|standard|full  # response size: minimal ~1KB, standard ~10KB, full raw',
    '',
    'Auth file lookup order:',
    '  1. AUTH_FILE',
    `  2. ${os.homedir()}/.propprofessor/auth.json`,
    '  3. ./auth.json in this repo',
    '',
    'If you are new here, install your browser session with:',
    '  pp-query install-auth --source /path/to/auth.json',
    '',
    'Default auth location:',
    `  ${os.homedir()}/.propprofessor/auth.json`
  ].join('\n');
}

function buildInstallAuthReport(result) {
  return {
    command: 'install-auth',
    ok: true,
    sourceFile: result.sourceFile,
    destinationFile: result.destinationFile,
    usedExistingFile: Boolean(result.usedExistingFile),
    nextStep: 'Run `pp-query doctor` to verify that the installed auth file works.'
  };
}

function getNodeVersionStatus() {
  const major = Number(String(process.versions?.node || '').split('.')[0] || 0);
  return {
    ok: major >= 18,
    current: process.versions?.node || 'unknown',
    required: '18+'
  };
}

function buildDoctorReport(healthResult) {
  const node = getNodeVersionStatus();
  const auth = inspectAuthSetup();
  const endpointOk = Boolean(healthResult?.ok);
  const sessionExpiry = auth.sessionExpiry;

  let nextStep = 'Ready to add this server to your MCP client.';
  if (!node.ok) {
    nextStep = 'Install Node.js 18 or newer, then rerun `pp-query doctor`.';
  } else if (!auth.ok) {
    nextStep = `Save your PropProfessor browser session to ${auth.defaultUserAuthFile} or set AUTH_FILE, then rerun \`pp-query doctor\`.`;
  } else if (sessionExpiry && sessionExpiry.status === 'expired') {
    nextStep = `Session expired. Run \`pp-query login\` to re-authenticate.`;
  } else if (sessionExpiry && sessionExpiry.status === 'critical') {
    nextStep = `Session expires in ${sessionExpiry.daysRemaining} day(s). Run \`pp-query login\` before it expires.`;
  } else if (!endpointOk) {
    nextStep =
      'Your auth file was found, but the live health check failed. Refresh your browser session and rerun `pp-query doctor`.';
  }

  return {
    command: 'doctor',
    ok: node.ok && auth.ok && endpointOk,
    checks: {
      node,
      auth,
      endpoint: {
        ok: endpointOk,
        details: healthResult || null
      }
    },
    summary: {
      node: node.ok ? 'ok' : 'error',
      auth: auth.ok ? 'ok' : 'error',
      endpoint: endpointOk ? 'ok' : 'error',
      session: sessionExpiry ? sessionExpiry.status : 'unknown',
      sessionExpiresAt: sessionExpiry?.sessionExpiry || null,
      sessionDaysRemaining: sessionExpiry?.daysRemaining || null,
      sessionWarning: sessionExpiry?.warning || null
    },
    nextStep
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const [command = 'help'] = args;
  const opts = {};

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--player' || arg === '-p') {
      opts.player = next;
      i += 1;
    } else if (arg === '--market' || arg === '-m') {
      opts.market = next;
      i += 1;
    } else if (arg === '--line' || arg === '-l') {
      opts.line = next;
      i += 1;
    } else if (arg === '--side' || arg === '-s') {
      opts.side = next;
      i += 1;
    } else if (arg === '--limit') {
      opts.limit = next;
      i += 1;
    } else if (arg === '--verbosity' || arg === '-v') {
      opts.verbosity = next;
      i += 1;
    } else if (arg === '--max-age-ms' || arg === '--maxAgeMs') {
      opts.maxAgeMs = next;
      i += 1;
    } else if (arg === '--lookback-hours' || arg === '--lookbackHours') {
      opts.lookbackHours = next;
      i += 1;
    } else if (arg === '--league' || arg === '-g') {
      opts.league = next;
      i += 1;
    } else if (arg === '--books' || arg === '-b') {
      opts.books = next;
      i += 1;
    } else if (arg === '--book' || arg === '--target-book' || arg === '--targetBook') {
      opts.book = next;
      opts.targetBook = next;
      i += 1;
    } else if (arg === '--leagues') {
      opts.leagues = next;
      i += 1;
    } else if (arg === '--markets') {
      opts.market = next;
      opts.markets = next;
      i += 1;
    } else if (arg === '--event-date' || arg === '--eventDate') {
      opts.eventDate = next;
      i += 1;
    } else if (arg === '--card-window' || arg === '--cardWindow') {
      opts.cardWindow = next;
      i += 1;
    } else if (arg === '--upcoming-only' || arg === '--upcomingOnly') {
      opts.upcomingOnly = true;
    } else if (arg === '--max-hours-away' || arg === '--maxHoursAway') {
      opts.maxHoursAway = next;
      i += 1;
    } else if (arg === '--scan-limit' || arg === '--scanLimit') {
      opts.scanLimit = next;
      i += 1;
    } else if (arg === '--min-odds' || arg === '--minOdds') {
      opts.minOdds = next;
      i += 1;
    } else if (arg === '--max-odds' || arg === '--maxOdds') {
      opts.maxOdds = next;
      i += 1;
    } else if (arg === '--min-consensus-book-count' || arg === '--minConsensusBookCount') {
      opts.minConsensusBookCount = next;
      i += 1;
    } else if (arg === '--broad') {
      opts.broad = true;
      opts.strict = false;
    } else if (arg === '--include-passes' || arg === '--includePasses') {
      opts.includePasses = true;
    } else if (arg === '--allow-recent-only' || arg === '--allowRecentOnly') {
      opts.allowRecentOnly = true;
    } else if (arg === '--source') {
      opts.source = next;
      i += 1;
    } else if (arg === '--dest' || arg === '--destination') {
      opts.destination = next;
      i += 1;
    } else if (arg === '--live') {
      opts.live = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--debug') {
      opts.debug = true;
    } else if (arg === '--no-debug') {
      opts.debug = false;
    } else if (arg === '--group-by' || arg === '--groupBy') {
      opts.groupBy = next;
      i += 1;
    } else if (arg === '--since') {
      opts.since = next;
      i += 1;
    } else if (arg === '--days') {
      opts.days = next;
      i += 1;
    } else if (arg === '--timeout') {
      opts.timeout = next;
      i += 1;
    }
  }

  return { command, opts };
}

function extractRows(payload) {
  return extractScreenRows(payload);
}

function emitJson(logger, payload) {
  logger.log(JSON.stringify(payload, null, 2));
}

async function queryTennisPayloads(client, { market, books, is_live } = {}) {
  const tennisQuery =
    typeof client.queryScreenOdds === 'function'
      ? client.queryScreenOdds.bind(client)
      : client.queryScreenOddsBestComps.bind(client);
  const payloads = [];

  for (const tennisMarket of normalizeTennisMarketQuery(market || 'Moneyline')) {
    payloads.push(
      await tennisQuery({
        league: 'Tennis',
        market: tennisMarket,
        books,
        is_live
      })
    );
  }

  return payloads;
}

function resolveScreenCommand(command, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(LEAGUE_ALIASES, command)) {
    return {
      command: 'screen',
      league: LEAGUE_ALIASES[command] || opts.league || 'NBA'
    };
  }
  return {
    command,
    league: opts.league || 'NBA'
  };
}

function formatLocalStart(value, timeZone = getLocalTimezone()) {
  if (!value) return null;
  const raw = String(value);
  const hasExplicitZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(raw);
  const date = new Date(hasExplicitZone ? raw : `${raw}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).format(date);
}

function normalizeScreenRowTimes(rows, timeZone = getLocalTimezone()) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const startLabel = formatLocalStart(row?.start, timeZone);
    return {
      ...row,
      startRaw: row?.start ?? null,
      startLocal: startLabel,
      startDisplay: startLabel
    };
  });
}

function getMultiValueOption(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toBooleanOption(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return !['false', '0', 'no', 'off'].includes(normalized);
}

function renderUfcCardOutput(result, logger = console) {
  const officialPlays = Array.isArray(result?.officialPlays) ? result.officialPlays : [];
  const bestLooks = Array.isArray(result?.bestLooks) ? result.bestLooks : [];
  const passes = Array.isArray(result?.passes) ? result.passes : [];
  const summaryText =
    result?.summaryText ||
    result?.summary ||
    `UFC card: ${officialPlays.length} official bet${officialPlays.length === 1 ? '' : 's'}, ${bestLooks.length} look${bestLooks.length === 1 ? '' : 's'}, ${passes.length} pass${passes.length === 1 ? '' : 'es'}.`;

  const lines = [];
  const addSection = (title, rows) => {
    lines.push(title);
    if (!rows.length) {
      lines.push('  (none)');
      return;
    }
    rows.slice(0, 10).forEach((row, index) => {
      const label =
        row?.summary ||
        row?.label ||
        row?.name ||
        row?.fighter ||
        row?.participant ||
        row?.selection ||
        row?.market ||
        row?.title ||
        JSON.stringify(row);
      lines.push(`  ${index + 1}. ${label}`);
    });
  };

  addSection('Official UFC bets', officialPlays);
  addSection('Best UFC looks', bestLooks);
  addSection('Passes', passes);
  lines.push('Summary');
  lines.push(`  ${summaryText}`);

  logger.log(lines.join('\n'));
}

async function main({ argv = process.argv, client = createPropProfessorClient(), logger = console } = {}) {
  const { command, opts } = parseArgs(argv);
  const screenCommand = resolveScreenCommand(command, opts);

  if (command === 'help') {
    logger.log(buildHelpText());
    process.exitCode = 0;
    return;
  }

  if (command === 'list') {
    emitJson(logger, { command, commands: getCommandInventory() });
    return;
  }

  if (command === 'setup') {
    const CONFIG_DIR = path.join(os.homedir(), '.propprofessor');
    const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
    const DEFAULT_PATH = path.join(__dirname, '..', 'config.default.json');

    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    if (fs.existsSync(CONFIG_PATH)) {
      emitJson(logger, { command: 'setup', status: 'exists', path: CONFIG_PATH });
      return;
    }

    const defaults = fs.readFileSync(DEFAULT_PATH, 'utf8');
    fs.writeFileSync(CONFIG_PATH, defaults, { mode: 0o600 });
    emitJson(logger, { command: 'setup', status: 'created', path: CONFIG_PATH });
    return;
  }

  if (command === 'opinion') {
    const rows = extractRows(await client.querySportsbook());
    const query = {
      player: opts.player,
      market: opts.market,
      line: opts.line !== undefined ? Number(opts.line) : undefined,
      side: opts.side
    };
    const result = analyzePlayerPropBet(query, rows);
    emitJson(logger, result);
    return;
  }

  let payload;
  let payloads = null;
  if (command === 'sportsbook') {
    payload = await client.querySportsbook();
  } else if (command === 'ufc-card') {
    const handlers = createMcpHandlers({ client });
    const result = await handlers.ufc_card({
      book: opts.book || opts.targetBook,
      targetBook: opts.targetBook || opts.book,
      markets: getMultiValueOption(opts.markets || opts.market),
      eventDate: opts.eventDate,
      cardWindow: opts.cardWindow,
      upcomingOnly: toBooleanOption(opts.upcomingOnly),
      maxHoursAway: opts.maxHoursAway !== undefined ? Number(opts.maxHoursAway) : undefined,
      limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
      scanLimit: opts.scanLimit !== undefined ? Number(opts.scanLimit) : undefined,
      debug: toBooleanOption(opts.debug),
      is_live: Boolean(opts.live)
    });
    if (opts.json) {
      emitJson(logger, result);
    } else {
      renderUfcCardOutput(result, logger);
    }
    return;
  } else if (command === 'smart') {
    payload = await client.querySmartMoney();
  } else if (command === 'tennis') {
    payloads = await queryTennisPayloads(client, {
      market: opts.market || 'Moneyline',
      books: opts.books
        ? String(opts.books)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      is_live: Boolean(opts.live)
    });
    payload = payloads[0] || { game_data: [] };
  } else if (command === 'sharp-plays') {
    payload = { game_data: [] };
  } else if (screenCommand.command === 'screen') {
    payload = await client.queryScreenOddsBestComps({
      league: screenCommand.league,
      market: opts.market || 'Moneyline',
      books: opts.books
        ? String(opts.books)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      is_live: Boolean(opts.live)
    });
  } else if (command === 'presets') {
    const leagues = ['NBA', 'WNBA', 'MLB', 'NFL', 'NHL', 'UFC', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
    const presets = leagues.map((league) => getLeagueRankingPreset(league));
    emitJson(logger, { command, presets });
    return;
  } else if (command === 'health') {
    const result = await client.healthStatus();
    emitJson(logger, { command, ...result });
    return;
  } else if (command === 'doctor') {
    let healthResult;
    try {
      healthResult = await client.healthStatus();
    } catch (error) {
      healthResult = {
        ok: false,
        error: String(error?.message || error)
      };
    }
    emitJson(logger, buildDoctorReport(healthResult));
    return;
  } else if (command === 'install-auth') {
    if (!opts.source) {
      throw new Error(`install-auth requires --source. Example: pp-query install-auth --source /path/to/auth.json`);
    }
    const installResult = installAuthFile({
      sourceFile: opts.source,
      destinationFile: opts.destination || DEFAULT_USER_AUTH_FILE
    });
    emitJson(logger, buildInstallAuthReport(installResult));
    return;
  } else if (command === 'login') {
    const { loginCli } = require('./pp-login');
    await loginCli({
      authFile: opts.destination || DEFAULT_USER_AUTH_FILE,
      timeoutMs: opts.timeout ? Number(opts.timeout) : undefined,
      json: Boolean(opts.json),
      logger
    });
    return;
  } else if (command === 'exe') {
    // Launch the tier-ranked plays display
    const { execSync } = require('child_process');
    const scriptPath = require('path').join(__dirname, 'prop-professor.exe.js');
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
    return;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const rows = extractRows(payload);
  const lookbackHours = getOddsHistoryLookbackHours(opts.lookbackHours);
  const debug = getDebugFlag(opts.debug, true);
  if (command === 'sharp-plays') {
    const targetBook = opts.book || opts.targetBook || opts.books?.split(',')?.[0] || 'NoVigApp';
    const leagues = opts.leagues
      ? String(opts.leagues)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : opts.league
        ? [opts.league]
        : Array.from(DEFAULT_LEAGUES);
    const markets = opts.markets
      ? String(opts.markets)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [opts.market || 'Moneyline'];
    const { createMcpHandlers } = require('./propprofessor-mcp-server');
    const handlers = createMcpHandlers({ client });
    const result = await handlers.sharp_plays({
      book: targetBook,
      leagues,
      markets,
      limit: opts.limit ? Number(opts.limit) : 10,
      scanLimit: opts.scanLimit ? Number(opts.scanLimit) : undefined,
      minOdds: opts.minOdds !== undefined ? Number(opts.minOdds) : undefined,
      maxOdds: opts.maxOdds !== undefined ? Number(opts.maxOdds) : undefined,
      minConsensusBookCount: opts.minConsensusBookCount !== undefined ? Number(opts.minConsensusBookCount) : undefined,
      includePasses: Boolean(opts.includePasses),
      strict: opts.strict !== undefined ? opts.strict : !opts.broad,
      allowRecentOnly: Boolean(opts.allowRecentOnly),
      maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : undefined,
      lookbackHours,
      debug,
      is_live: Boolean(opts.live),
      verbosity: opts.verbosity || 'standard'
    });
    emitJson(logger, result);
    return;
  }
  if (command === 'tennis') {
    const tennisBooks = opts.books
      ? String(opts.books)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['Pinnacle', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'];
    const result = await buildRankedScreenResponse({
      client,
      payloads: Array.isArray(payloads) && payloads.length ? payloads : [payload],
      args: {
        books: tennisBooks,
        historySportsbooks: tennisBooks,
        limit: opts.limit ? Number(opts.limit) : 12,
        includeAll: true,
        maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null,
        lookbackHours,
        debug
      },
      league: 'Tennis',
      focusBook: tennisBooks[0] || 'Pinnacle',
      rankRows: (hydratedRows, { debug: rankedDebug } = {}) =>
        rankTennisScreenRows(hydratedRows, {
          limit: opts.limit ? Number(opts.limit) : 12,
          includeAll: true,
          maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null,
          preferredBook: tennisBooks[0] || 'Pinnacle',
          debug: rankedDebug
        }),
      resultMeta: {
        command,
        notes: {
          consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
          clvProxy: 'open odds vs current odds when history fields are present',
          timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
        }
      }
    });
    // Correct tennis match times via SportScore before localizing
    if (result?.result) {
      result.result = await correctTennisTimes(result.result);
    }
    const normalized = normalizeScreenRowTimes(result.result);
    result.result = normalized;
    result.count = normalized.length;
    result.sample = normalized;
    result.notes = {
      ...(result.notes || {}),
      movementAvailable: normalized.some((row) => row.lineHistoryUsable || row.clvProxyPct !== null),
      consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
      clvProxy: 'open odds vs current odds when history fields are present',
      timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
    };
    emitJson(logger, result);
    return;
  }

  if (screenCommand.command === 'screen') {
    const screenBooks = opts.books
      ? String(opts.books)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'];
    const result = await buildRankedScreenResponse({
      client,
      payloads: [payload],
      args: {
        books: screenBooks,
        historySportsbooks: screenBooks,
        limit: opts.limit ? Number(opts.limit) : 12,
        includeAll: true,
        maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null,
        lookbackHours,
        debug
      },
      league: screenCommand.league,
      focusBook: screenBooks[0] || 'NoVigApp',
      rankRows: (hydratedRows, { debug: rankedDebug } = {}) =>
        rankLeagueScreenRows(hydratedRows, {
          league: screenCommand.league,
          market: opts.market || 'Moneyline',
          limit: opts.limit ? Number(opts.limit) : 12,
          includeAll: true,
          maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null,
          books: screenBooks,
          debug: rankedDebug
        }),
      resultMeta: {
        command,
        notes: {
          consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
          clvProxy: 'open odds vs current odds when history fields are present',
          timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
        }
      }
    });
    const normalized = normalizeScreenRowTimes(result.result);
    result.result = normalized;
    result.count = normalized.length;
    result.sample = normalized;
    result.notes = {
      ...(result.notes || {}),
      movementAvailable: normalized.some((row) => row.lineHistoryUsable || row.clvProxyPct !== null),
      consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
      clvProxy: 'open odds vs current odds when history fields are present',
      timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
    };
    emitJson(logger, result);
    return;
  }

  const filtered = rows.filter((row) => {
    const text = JSON.stringify(row).toLowerCase();
    const playerOk = !opts.player || text.includes(String(opts.player).toLowerCase());
    const marketOk = !opts.market || text.includes(String(opts.market).toLowerCase());
    const lineOk = opts.line === undefined || text.includes(String(opts.line));
    const sideOk = !opts.side || text.includes(String(opts.side).toLowerCase());
    return playerOk && marketOk && lineOk && sideOk;
  });
  emitJson(logger, { command, count: filtered.length, sample: filtered.slice(0, 10) });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDoctorReport,
  buildHelpText,
  buildInstallAuthReport,
  getCommandInventory,
  parseArgs,
  resolveScreenCommand,
  extractRows,
  main
};
