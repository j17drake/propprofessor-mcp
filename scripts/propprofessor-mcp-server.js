'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { extractScreenRows, normalizeTennisMarketQuery, rankScreenRows, rankTennisScreenRows, rankLeagueScreenRows, summarizeFreshness, getLeagueRankingPreset } = require('../lib/propprofessor-analysis');
const { getSharpBookComparisonSet, getSharpBookContext } = require('../lib/propprofessor-sharp-books');
const {
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
} = require('../lib/propprofessor-mcp-stdio');

const SERVER_NAME = 'propprofessor';
const SERVER_VERSION = '0.1.0';
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
      description: 'Query /screen using a market-aware sharp-book comparison set with league-specific defaults.',
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
      description: 'Query /screen and return ranked rows with consensus and movement metadata for any market.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          league: { type: 'string', description: 'League such as NBA' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_sport_screen',
      description: 'Query /screen for any supported sport using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          league: { type: 'string', description: 'Sport or league such as NBA, WNBA, MLB, NFL, NHL, SOCCER, NCAAB, NCAAF, or TENNIS' },
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          games: { type: 'array', items: { type: 'string' }, description: 'Optional game ids from the screen dropdown' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'query_nba_screen',
      description: 'Query /screen for NBA using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          games: { type: 'array', items: { type: 'string' }, description: 'Optional game ids from the screen dropdown' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_wnba_screen',
      description: 'Query /screen for WNBA using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          games: { type: 'array', items: { type: 'string' }, description: 'Optional game ids from the screen dropdown' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_mlb_screen',
      description: 'Query /screen for MLB using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nfl_screen',
      description: 'Query /screen for NFL using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nhl_screen',
      description: 'Query /screen for NHL using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_soccer_screen',
      description: 'Query /screen for Soccer using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaab_screen',
      description: 'Query /screen for NCAAB using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaaf_screen',
      description: 'Query /screen for NCAAF using the market-aware sharp-book default comparison set.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_tennis_screen',
      description: 'Query /screen for tennis, rank the results by consensus edge and CLV proxy, and return the top tennis plays.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Optional market filter, default Moneyline. Use Moneyline, Spread, or Total.' },
          limit: { type: 'number', description: 'Max number of ranked plays to return' },
          book: { type: 'string', description: 'Preferred book to rank, default NoVigApp. Set to Fliff for Fliff-only results.' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional book filters for the backend query' },
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
  function queryScreenWithLeague(league, args = {}) {
    return client.queryScreenOddsBestComps({
      market: args.market || 'Moneyline',
      league,
      games: Array.isArray(args.games) ? args.games : [],
      participants: Array.isArray(args.participants) ? args.participants : [],
      books: Array.isArray(args.books) ? args.books : [],
      is_live: Boolean(args.is_live)
    }).then(payload => {
      const rows = extractScreenRows(payload);
      const ranked = rankLeagueScreenRows(rows, {
        league,
        limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 12,
        books: Array.isArray(args.books) && args.books.length ? args.books : undefined,
        includeAll: args.includeAll !== undefined ? Boolean(args.includeAll) : true,
        maxAgeMs: Number.isFinite(Number(args.maxAgeMs)) ? Number(args.maxAgeMs) : null
      });
      return { ok: true, result: ranked, freshness: summarizeFreshness(rows) };
    });
  }

  return {
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
      const payload = await client.queryScreenOddsBestComps({
        market: args.market || 'Moneyline',
        league: args.league || 'NBA',
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : [],
        is_live: Boolean(args.is_live)
      });
      const rows = extractScreenRows(payload);
      const ranked = rankLeagueScreenRows(rows, {
        league: args.league || 'NBA',
        limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 12,
        books: Array.isArray(args.books) && args.books.length ? args.books : undefined,
        includeAll: args.includeAll !== undefined ? Boolean(args.includeAll) : true,
        maxAgeMs: Number.isFinite(Number(args.maxAgeMs)) ? Number(args.maxAgeMs) : null
      });
      return { ok: true, result: ranked, freshness: summarizeFreshness(rows) };
    },
    async query_sport_screen(args = {}) {
      const league = String(args.league || '').trim();
      if (!league) {
        throw new Error('league is required for query_sport_screen');
      }
      return queryScreenWithLeague(league, args);
    },
    async query_nba_screen(args = {}) {
      return queryScreenWithLeague('NBA', args);
    },
    async query_wnba_screen(args = {}) {
      return queryScreenWithLeague('WNBA', args);
    },
    async query_mlb_screen(args = {}) {
      return queryScreenWithLeague('MLB', args);
    },
    async query_nfl_screen(args = {}) {
      return queryScreenWithLeague('NFL', args);
    },
    async query_nhl_screen(args = {}) {
      return queryScreenWithLeague('NHL', args);
    },
    async query_soccer_screen(args = {}) {
      return queryScreenWithLeague('SOCCER', args);
    },
    async query_ncaab_screen(args = {}) {
      return queryScreenWithLeague('NCAAB', args);
    },
    async query_ncaaf_screen(args = {}) {
      return queryScreenWithLeague('NCAAF', args);
    },
    async query_tennis_screen(args = {}) {
      const preferredBook = String(args.book || 'NoVigApp').trim() || 'NoVigApp';
      const marketQuery = normalizeTennisMarketQuery(args.market || 'Moneyline');
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 12;
      const maxAgeMs = Number.isFinite(Number(args.maxAgeMs)) ? Number(args.maxAgeMs) : null;
      const queryFn = typeof client.queryScreenOdds === 'function'
        ? client.queryScreenOdds.bind(client)
        : client.queryScreenOddsBestComps.bind(client);
      const payloads = [];

      for (const market of marketQuery) {
        const payload = await queryFn({
          market,
          league: 'Tennis',
          books: Array.isArray(args.books) ? args.books : Array.from(new Set([
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

      const rows = payloads.flatMap(payload => extractScreenRows(payload));
      const ranked = rankTennisScreenRows(rows, {
        limit,
        preferredBook,
        includeAll: true,
        maxAgeMs
      });
      return { ok: true, result: ranked, freshness: summarizeFreshness(rows) };
    },
    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },
    async health_status() {
      const result = await client.healthStatus();
      return { ok: true, result };
    }
  };
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
