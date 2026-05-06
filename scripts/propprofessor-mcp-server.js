'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { normalizeTennisMarketQuery, rankScreenRows, rankTennisScreenRows, rankLeagueScreenRows } = require('../lib/propprofessor-screen-utils');
const {
  buildRankedScreenResponse: buildRankedScreenResponseShared,
  getIncludeAll,
  getLeagueRankingPreset,
  getLimit,
  getMaxAgeMs,
  normalizeBookList
} = require('../lib/propprofessor-mcp-ranked-screen');
const { getSharpBookComparisonSet, getSharpBookContext } = require('../lib/propprofessor-sharp-books');
const {
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
} = require('../lib/propprofessor-mcp-stdio');

const SERVER_NAME = 'propprofessor';
const SERVER_VERSION = require('../package.json').version;
const PROTOCOL_VERSION = '2024-11-05';

function buildToolDefinitions() {
  return [
    {
      name: 'query_screen_odds',
      description: 'Query the live Odds Screen payload from /screen with the current league, market, game, and participant filters.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          league: { type: 'string', description: 'League such as NBA' },
          games: { type: 'array', items: { type: 'string' }, description: 'Optional game ids from the screen dropdown' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional display books filter' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },

    {
      name: 'query_screen_odds_best_comps',
      description: 'Query /screen using a sharper default comparison set. Defaults to Pinnacle, Polymarket, Kalshi, BetOnline, and Circa cross-sport, switches NBA and NFL to the Dec 2024 Pikkit hierarchy, and switches MLB to the PromoGuy/Pikkit MLB hierarchy.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          league: { type: 'string' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_screen_odds_ranked',
      description: 'Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata for any market.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          league: { type: 'string', description: 'League such as NBA' },
          games: { type: 'array', items: { type: 'string' }, description: 'Optional game ids or identifiers to filter the query' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_sport_screen',
      description: 'Query /screen for any supported league and return league-specific ranked rows.',
      inputSchema: {
        type: 'object',
        properties: {
          league: { type: 'string', description: 'Supported league such as NBA, WNBA, MLB, NFL, NHL, soccer, NCAAB, NCAAF, or Tennis' },
          market: { type: 'string', description: 'Optional market filter, default Moneyline' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'query_nba_screen',
      description: 'Query /screen for NBA and return ranked rows with NBA presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_wnba_screen',
      description: 'Query /screen for WNBA and return ranked rows with WNBA presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_mlb_screen',
      description: 'Query /screen for MLB and return ranked rows with MLB presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nfl_screen',
      description: 'Query /screen for NFL and return ranked rows with NFL presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nhl_screen',
      description: 'Query /screen for NHL and return ranked rows with NHL presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_soccer_screen',
      description: 'Query /screen for soccer and return ranked rows with soccer presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaab_screen',
      description: 'Query /screen for NCAAB and return ranked rows with NCAAB presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaaf_screen',
      description: 'Query /screen for NCAAF and return ranked rows with NCAAF presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_tennis_screen',
      description: 'Query /screen for tennis and return the top ranked tennis plays.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Optional market filter, default Moneyline. Use Moneyline, Spread, or Total.' },
          limit: { type: 'number', description: 'Max number of ranked plays to return' },
          book: { type: 'string', description: 'Preferred book to rank, default Pinnacle. Set to Fliff for Fliff-only results.' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional book filters for the backend query' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          is_live: { type: 'boolean', description: 'Whether to query live tennis odds' }
        },
        additionalProperties: false
      }
    },

    {
      name: 'league_presets',
      description: 'Return the current sport-specific ranking presets used by screen ranking.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'health_status',
      description: 'Check auth freshness and confirm the PropProfessor screen endpoint responds.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  ];
}

// league preset inspector
function buildLeaguePresetSummary() {
  const leagues = ['NBA', 'WNBA', 'MLB', 'NFL', 'NHL', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
  return leagues.map(league => {
    const preset = getLeagueRankingPreset(league);
    const isSharpLeague = ['NBA', 'NFL', 'MLB'].includes(league);
    const sharpMainMarkets = isSharpLeague
      ? getSharpBookComparisonSet({ league, market: 'Moneyline' })
      : undefined;
    const sharpProps = isSharpLeague
      ? getSharpBookComparisonSet({ league, market: league === 'MLB' ? 'Player Strikeouts' : 'Player Points' })
      : undefined;

    return {
      ...preset,
      sharpMainMarkets,
      sharpProps,
      sharpBookVariants: isSharpLeague
        ? {
            mainMarkets: sharpMainMarkets,
            playerProps: sharpProps
          }
        : undefined,
      sharpBookResearch: getSharpBookContext({ league, market: league === 'MLB' ? 'Moneyline' : undefined })
    };
  });
}


function createMcpHandlers({ client = createPropProfessorClient() } = {}) {
  const leagueAliases = {
    query_nba_screen: 'NBA',
    query_wnba_screen: 'WNBA',
    query_mlb_screen: 'MLB',
    query_nfl_screen: 'NFL',
    query_nhl_screen: 'NHL',
    query_soccer_screen: 'Soccer',
    query_ncaab_screen: 'NCAAB',
    query_ncaaf_screen: 'NCAAF'
  };

  async function runLeagueScreen(args = {}, league) {
    const requestedBooks = normalizeBookList(args.books);
    const market = args.market || 'Moneyline';
    const preset = getLeagueRankingPreset(league, market);
    const focusBook = requestedBooks[0] || preset.preferredBooks[0];
    const payload = await client.queryScreenOddsBestComps({
      market,
      league,
      games: Array.isArray(args.games) ? args.games : [],
      participants: Array.isArray(args.participants) ? args.participants : [],
      books: requestedBooks,
      is_live: Boolean(args.is_live)
    });
    return buildRankedScreenResponseShared({
      client,
      payloads: [payload],
      args,
      league,
      focusBook,
      rankRows: hydratedRows => rankLeagueScreenRows(hydratedRows, {
        league,
        market,
        limit: getLimit(args),
        books: requestedBooks.length ? requestedBooks : undefined,
        includeAll: getIncludeAll(args),
        maxAgeMs: getMaxAgeMs(args)
      })
    });
  }

  async function runSportScreen(args = {}) {
    const requestedLeague = String(args.league || '').trim();
    if (!requestedLeague) {
      throw new Error('league is required');
    }
    const presetLeague = getLeagueRankingPreset(requestedLeague).league;
    return presetLeague === 'TENNIS'
      ? handlers.query_tennis_screen(args)
      : runLeagueScreen(args, presetLeague || requestedLeague);
  }

  const handlers = {
    async query_screen_odds(args = {}) {
      const payload = await client.queryScreenOdds({
        market: args.market || 'Moneyline',
        league: args.league || 'NBA',
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : [],
        is_live: Boolean(args.is_live)
      });
      return { ok: true, result: payload };
    },

    async query_screen_odds_best_comps(args = {}) {
      const payload = await client.queryScreenOddsBestComps({
        market: args.market,
        league: args.league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : undefined,
        is_live: Boolean(args.is_live)
      });
      return {
        ok: true,
        result: payload,
        comparisonBooks: getSharpBookComparisonSet({
          league: args.league || 'NBA',
          market: args.market,
          requestedBooks: Array.isArray(args.books) ? args.books : undefined
        }),
        sharpBookResearch: getSharpBookContext({ league: args.league || 'NBA', market: args.market })
      };
    },
    async query_screen_odds_ranked(args = {}) {
      const requestedBooks = normalizeBookList(args.books);
      const league = args.league || 'NBA';
      const market = args.market || 'Moneyline';
      const preset = getLeagueRankingPreset(league, market);
      const focusBook = requestedBooks[0] || preset.preferredBooks[0];
      const payload = await client.queryScreenOddsBestComps({
        market,
        league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: requestedBooks,
        is_live: Boolean(args.is_live)
      });
      return buildRankedScreenResponseShared({
        client,
        payloads: [payload],
        args,
        league,
        focusBook,
        rankRows: hydratedRows => rankLeagueScreenRows(hydratedRows, {
          league,
          market,
          limit: getLimit(args),
          books: requestedBooks.length ? requestedBooks : undefined,
          includeAll: getIncludeAll(args),
          maxAgeMs: getMaxAgeMs(args)
        })
      });
    },
    async query_sport_screen(args = {}) {
      return runSportScreen(args);
    },
    async query_nba_screen(args = {}) {
      return runLeagueScreen(args, 'NBA');
    },
    async query_wnba_screen(args = {}) {
      return runLeagueScreen(args, 'WNBA');
    },
    async query_mlb_screen(args = {}) {
      return runLeagueScreen(args, 'MLB');
    },
    async query_nfl_screen(args = {}) {
      return runLeagueScreen(args, 'NFL');
    },
    async query_nhl_screen(args = {}) {
      return runLeagueScreen(args, 'NHL');
    },
    async query_soccer_screen(args = {}) {
      return runLeagueScreen(args, 'Soccer');
    },
    async query_ncaab_screen(args = {}) {
      return runLeagueScreen(args, 'NCAAB');
    },
    async query_ncaaf_screen(args = {}) {
      return runLeagueScreen(args, 'NCAAF');
    },
    async query_tennis_screen(args = {}) {
      const preferredBook = String(args.book || 'Pinnacle').trim() || 'Pinnacle';
      const requestedBooks = normalizeBookList(args.books);
      const marketQuery = normalizeTennisMarketQuery(args.market || 'Moneyline');
      const queryFn = typeof client.queryScreenOdds === 'function'
        ? client.queryScreenOdds.bind(client)
        : client.queryScreenOddsBestComps.bind(client);
      const payloads = [];

      for (const market of marketQuery) {
        const payload = await queryFn({
          market,
          league: 'Tennis',
          books: requestedBooks.length ? requestedBooks : Array.from(new Set([
            preferredBook,
            'NoVigApp',
            'Polymarket',
            'Kalshi',
            'BetOnline',
            'Circa'
          ])),
          is_live: Boolean(args.is_live)
        });
        payloads.push(payload);
      }

      return buildRankedScreenResponseShared({
        client,
        payloads,
        args,
        league: 'Tennis',
        focusBook: preferredBook,
        rankRows: hydratedRows => rankTennisScreenRows(hydratedRows, {
          limit: getLimit(args),
          preferredBook,
          includeAll: getIncludeAll(args),
          maxAgeMs: getMaxAgeMs(args)
        })
      });
    },

    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },
    async health_status() {
      const result = await client.healthStatus();
      return { ok: true, result };
    }
  };

  return handlers;
}

function createMcpServer({ handlers = createMcpHandlers(), toolDefinitions = buildToolDefinitions() } = {}) {
  const toolMap = new Map(toolDefinitions.map(tool => [tool.name, tool]));
  let initialized = false;

  async function handleRequest(message) {
    const { id = null, method, params } = message || {};

    if (method === 'initialize') {
      initialized = true;
      return createJsonRpcSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (!initialized) {
      return createJsonRpcError(id, -32002, 'Server not initialized');
    }

    if (method === 'tools/list') {
      return createJsonRpcSuccess(id, { tools: toolDefinitions });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const handler = handlers[toolName];
      if (!toolMap.has(toolName) || typeof handler !== 'function') {
        return createJsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
      try {
        const result = await handler(params?.arguments || {});
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        });
      } catch (error) {
        const categorized = categorizeError(error);
        const failure = {
          ok: false,
          error: {
            code: categorized.code,
            message: categorized.message,
            category: categorized.category,
            status: categorized.status
          }
        };
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          structuredContent: failure,
          isError: true
        });
      }
    }

    return createJsonRpcError(id, -32601, `Method not found: ${method}`);
  }

  return {
    async handleRequest(message) {
      return handleRequest(message);
    },
    toolDefinitions
  };
}

async function serveStdio(options = {}) {
  const server = createMcpServer(options);
  const reader = createStdioMessageReader(async message => {
    const response = await server.handleRequest(message);
    if (response && message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      process.stdout.write(encodeMessage(response));
    }
  });

  process.stdin.on('data', chunk => {
    Promise.resolve()
      .then(() => reader(chunk))
      .catch(error => {
        process.stderr.write((error.stack || error.message || String(error)) + '\n');
      });
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  process.stdin.resume();
}

if (require.main === module) {
  serveStdio().catch(err => {
    process.stderr.write((err.stack || err.message) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  buildToolDefinitions,
  createMcpHandlers,
  createMcpServer,
  createStdioMessageReader,
  encodeMessage,
  serveStdio
};
