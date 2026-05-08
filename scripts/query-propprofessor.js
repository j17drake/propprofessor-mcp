'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { analyzePlayerPropBet } = require('../lib/propprofessor-analysis');
const { getLocalTimezone, getOddsHistoryLookbackHours } = require('../lib/mcp-runtime-config');
const { rankTennisScreenRows, rankLeagueScreenRows, extractScreenRows, getLeagueRankingPreset } = require('../lib/propprofessor-screen-utils');
const {
  buildRankedScreenResponse,
  getDebugFlag
} = require('../lib/propprofessor-mcp-ranked-screen');

const LEAGUE_ALIASES = {
  sport: null,
  nba: 'NBA',
  wnba: 'WNBA',
  mlb: 'MLB',
  nfl: 'NFL',
  nhl: 'NHL',
  soccer: 'Soccer',
  ncaab: 'NCAAB',
  ncaaf: 'NCAAF'
};

function getCommandInventory() {
  return [
    { command: 'opinion', description: 'Analyze a single prop from sportsbook rows' },
    { command: 'sportsbook', description: 'Fetch sportsbook +EV rows' },
    { command: 'smart', description: 'Fetch smart money rows' },
    { command: 'tennis', description: 'Query and rank tennis screen rows' },
    { command: 'screen', description: 'Query and rank any supported league screen with --league' },
    { command: 'sport', description: 'Alias for screen, use --league to pick the sport' },
    { command: 'nba', description: 'NBA screen shorthand' },
    { command: 'wnba', description: 'WNBA screen shorthand' },
    { command: 'mlb', description: 'MLB screen shorthand' },
    { command: 'nfl', description: 'NFL screen shorthand' },
    { command: 'nhl', description: 'NHL screen shorthand' },
    { command: 'soccer', description: 'Soccer screen shorthand' },
    { command: 'ncaab', description: 'NCAAB screen shorthand' },
    { command: 'ncaaf', description: 'NCAAF screen shorthand' },
    { command: 'presets', description: 'Show active league ranking presets' },
    { command: 'list', description: 'Show the command inventory' },
    { command: 'health', description: 'Check auth and endpoint health' }
  ];
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
    } else if (arg === '--live') {
      opts.live = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--debug') {
      opts.debug = true;
    } else if (arg === '--no-debug') {
      opts.debug = false;
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
  return (Array.isArray(rows) ? rows : []).map(row => {
    const startLabel = formatLocalStart(row?.start, timeZone);
    return {
      ...row,
      startRaw: row?.start ?? null,
      startLocal: startLabel,
      startDisplay: startLabel
    };
  });
}

async function main({ argv = process.argv, client = createPropProfessorClient(), logger = console } = {}) {
  const { command, opts } = parseArgs(argv);
  const screenCommand = resolveScreenCommand(command, opts);

  if (command === 'help') {
    logger.log('Usage: node scripts/query-propprofessor.js opinion --player "James Harden" --market "Points" --line 18.5 --side over');
    process.exitCode = 0;
    return;
  }

  if (command === 'list') {
    emitJson(logger, { command, commands: getCommandInventory() });
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
  if (command === 'sportsbook') {
    payload = await client.querySportsbook();
  } else if (command === 'smart') {
    payload = await client.querySmartMoney();
  } else if (command === 'tennis') {
    const tennisQuery = typeof client.queryScreenOdds === 'function'
      ? client.queryScreenOdds.bind(client)
      : client.queryScreenOddsBestComps.bind(client);
    payload = await tennisQuery({
      league: 'Tennis',
      market: opts.market || 'Moneyline',
      books: opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : undefined,
      is_live: Boolean(opts.live)
    });
  } else if (screenCommand.command === 'screen') {
    payload = await client.queryScreenOddsBestComps({
      league: screenCommand.league,
      market: opts.market || 'Moneyline',
      books: opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : undefined,
      is_live: Boolean(opts.live)
    });
  } else if (command === 'presets') {
    const leagues = ['NBA', 'WNBA', 'MLB', 'NFL', 'NHL', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
    const presets = leagues.map(league => getLeagueRankingPreset(league));
    emitJson(logger, { command, presets });
    return;
  } else if (command === 'health') {
    const result = await client.healthStatus();
    emitJson(logger, { command, ...result });
    return;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const rows = extractRows(payload);
  const lookbackHours = getOddsHistoryLookbackHours(opts.lookbackHours);
  const debug = getDebugFlag(opts.debug, true);
  if (command === 'tennis') {
    const tennisBooks = opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : ['Pinnacle', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'];
    const queryFn = typeof client.queryScreenOdds === 'function'
      ? client.queryScreenOdds.bind(client)
      : client.queryScreenOddsBestComps.bind(client);
    const payloads = [payload];
    const result = await buildRankedScreenResponse({
      client,
      payloads,
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
      rankRows: (hydratedRows, { debug: rankedDebug } = {}) => rankTennisScreenRows(hydratedRows, {
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
    const normalized = normalizeScreenRowTimes(result.result);
    result.result = normalized;
    result.count = normalized.length;
    result.sample = normalized;
    result.notes = {
      ...(result.notes || {}),
      movementAvailable: normalized.some(row => row.lineHistoryUsable || row.clvProxyPct !== null),
      consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
      clvProxy: 'open odds vs current odds when history fields are present',
      timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
    };
    emitJson(logger, result);
    return;
  }

  if (screenCommand.command === 'screen') {
    const screenBooks = opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'];
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
      rankRows: (hydratedRows, { debug: rankedDebug } = {}) => rankLeagueScreenRows(hydratedRows, {
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
      movementAvailable: normalized.some(row => row.lineHistoryUsable || row.clvProxyPct !== null),
      consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
      clvProxy: 'open odds vs current odds when history fields are present',
      timeInterpretation: `start values without an explicit timezone are treated as UTC, displayed in ${getLocalTimezone()}`
    };
    emitJson(logger, result);
    return;
  }

  const filtered = rows.filter(row => {
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
  main().catch(err => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  getCommandInventory,
  parseArgs,
  resolveScreenCommand,
  extractRows,
  main
};
