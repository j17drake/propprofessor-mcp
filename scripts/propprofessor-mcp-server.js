'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { extractScreenRows, normalizeTennisMarketQuery, rankScreenRows, rankTennisScreenRows, rankLeagueScreenRows, summarizeFreshness, getLeagueRankingPreset } = require('../lib/propprofessor-analysis');

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
      name: 'query_fantasy',
      description: 'Query the live single-play fantasy payload from /fantasy with app, league, EV, and timing filters.',
      inputSchema: {
        type: 'object',
        properties: {
          fantasyApps: { type: 'array', items: { type: 'string' }, description: 'Fantasy apps such as PrizePicks or Underdog' },
          leagues: { type: 'array', items: { type: 'string' }, description: 'League filters such as NBA' },
          minOdds: { type: 'number' },
          maxOdds: { type: 'number' },
          minLegEV: { type: 'number' },
          minSlipEV: { type: 'number' },
          minHoursAway: { type: 'number' },
          maxHoursAway: { type: 'number' },
          hiddenBets: { type: 'array', items: { type: 'string' } },
          liveStatus: { type: 'string', description: 'prematch, live, or all depending on backend support' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_fantasy_sorted',
      description: 'Query /fantasy and return rows sorted by value descending, best plays first.',
      inputSchema: {
        type: 'object',
        properties: {
          fantasyApps: { type: 'array', items: { type: 'string' } },
          leagues: { type: 'array', items: { type: 'string' } },
          minOdds: { type: 'number' },
          maxOdds: { type: 'number' },
          minLegEV: { type: 'number' },
          minSlipEV: { type: 'number' },
          minHoursAway: { type: 'number' },
          maxHoursAway: { type: 'number' },
          hiddenBets: { type: 'array', items: { type: 'string' } },
          liveStatus: { type: 'string' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_screen_odds_best_comps',
      description: 'Query /screen using a sharper default comparison set: NoVigApp, Polymarket, Kalshi, BetOnline, and Circa.',
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
      name: 'hide_fantasy_row',
      description: 'Hide one /fantasy single-play row by exact id or by matching fantasy app, participant, market, selection type, and line.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact fantasy row id from the backend payload' },
          fantasyApp: { type: 'string', description: 'Fantasy app such as DraftKings6 or Underdog' },
          participant: { type: 'string', description: 'Player name, for example Jaylen Brown' },
          market: { type: 'string', description: 'Market name, for example Player Points' },
          selectionType: { type: 'string', description: 'Over or Under' },
          line: { type: 'number', description: 'Fantasy line, for example 22.5' },
          leagues: { type: 'array', items: { type: 'string' }, description: 'Optional league filter to narrow the match' },
          liveStatus: { type: 'string', description: 'prematch, live, or all' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'hide_ev_row',
      description: 'Hide one /positive_ev row by exact id or by matching book, participant, market, and line.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact +EV row id from the sportsbook payload' },
          book: { type: 'string', description: 'Sportsbook name, for example DraftKings or FanDuel' },
          participant: { type: 'string', description: 'Player or team name' },
          market: { type: 'string', description: 'Market name, for example Player Points or Point Spread' },
          selection: { type: 'string', description: 'Selection text, for example Jaylen Brown Over 22.5' },
          line: { type: 'number', description: 'Line value, for example 22.5' },
          leagues: { type: 'array', items: { type: 'string' }, description: 'Optional league filter to narrow the match' },
          userState: { type: 'string', description: 'Optional user state, default tx' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'get_hidden_bets',
      description: 'Get the current hidden bet list from PropProfessor.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'unhide_bet',
      description: 'Restore a hidden bet by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Hidden bet id to restore' }
        },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'clear_hidden_bets',
      description: 'Clear all hidden bets from PropProfessor.',
      inputSchema: {
        type: 'object',
        properties: {},
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
      description: 'Check auth freshness and confirm the PropProfessor screen and fantasy endpoints respond.',
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
  const leagues = ['NBA', 'MLB', 'NFL', 'NHL', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
  return leagues.map(league => getLeagueRankingPreset(league));
}


function createMcpHandlers({ client = createPropProfessorClient() } = {}) {
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
    async query_fantasy(args = {}) {
      const payload = await client.queryFantasyPicks({
        fantasyApps: Array.isArray(args.fantasyApps) ? args.fantasyApps : undefined,
        leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
        minOdds: args.minOdds,
        maxOdds: args.maxOdds,
        minLegEV: args.minLegEV,
        minSlipEV: args.minSlipEV,
        minHoursAway: args.minHoursAway,
        maxHoursAway: args.maxHoursAway,
        hiddenBets: Array.isArray(args.hiddenBets) ? args.hiddenBets : undefined,
        liveStatus: args.liveStatus
      });
      return { ok: true, result: payload };
    },
    async query_fantasy_sorted(args = {}) {
      const payload = await client.queryFantasyPicksSorted({
        fantasyApps: Array.isArray(args.fantasyApps) ? args.fantasyApps : undefined,
        leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
        minOdds: args.minOdds,
        maxOdds: args.maxOdds,
        minLegEV: args.minLegEV,
        minSlipEV: args.minSlipEV,
        minHoursAway: args.minHoursAway,
        maxHoursAway: args.maxHoursAway,
        hiddenBets: Array.isArray(args.hiddenBets) ? args.hiddenBets : undefined,
        liveStatus: args.liveStatus
      });
      return { ok: true, result: payload };
    },
    async query_screen_odds_best_comps(args = {}) {
      const payload = await client.queryScreenOddsBestComps({
        market: args.market,
        league: args.league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : [],
        is_live: Boolean(args.is_live)
      });
      return { ok: true, result: payload };
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
    async hide_fantasy_row(args = {}) {
      let match = null;
      if (args.id) {
        const rows = await client.queryFantasyPicks({
          fantasyApps: args.fantasyApp ? [args.fantasyApp] : undefined,
          leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
          liveStatus: args.liveStatus
        });
        match = (Array.isArray(rows) ? rows : []).find(row => row && row.id === args.id);
      } else {
        const rows = await client.queryFantasyPicks({
          fantasyApps: args.fantasyApp ? [args.fantasyApp] : undefined,
          leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
          liveStatus: args.liveStatus
        });
        const normalizedParticipant = String(args.participant || '').trim().toLowerCase();
        const normalizedMarket = String(args.market || '').trim().toLowerCase();
        const normalizedSelectionType = String(args.selectionType || '').trim().toLowerCase();
        const normalizedFantasyApp = String(args.fantasyApp || '').trim().toLowerCase();
        const targetLine = typeof args.line === 'number' ? args.line : Number(args.line);
        const candidates = (Array.isArray(rows) ? rows : []).filter(row => {
          if (!row) return false;
          if (normalizedFantasyApp && String(row.fantasyApp || '').trim().toLowerCase() !== normalizedFantasyApp) return false;
          if (normalizedParticipant && String(row.participant || '').trim().toLowerCase() !== normalizedParticipant) return false;
          if (normalizedMarket && String(row.market || '').trim().toLowerCase() !== normalizedMarket) return false;
          if (normalizedSelectionType && String(row.selectionType || '').trim().toLowerCase() !== normalizedSelectionType) return false;
          if (Number.isFinite(targetLine) && Number(row.line) !== targetLine) return false;
          return true;
        });
        if (candidates.length > 1) {
          throw new Error(`Ambiguous fantasy row match: found ${candidates.length} rows. Add id or narrow the filters.`);
        }
        match = candidates[0] || null;
      }
      if (!match) {
        throw new Error('Fantasy row not found for hide request.');
      }
      const payload = await client.hideBet({
        id: match.id,
        gameId: match.gameId,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        market: match.market,
        selectionId: match.selectionId,
        selection: match.selection,
        book: match.fantasyApp,
        odds: match.odds,
        value: match.value,
        page: 'Fantasy',
        start: match.start
      });
      return { ok: true, matched: match, result: payload };
    },
    async hide_ev_row(args = {}) {
      let match = null;
      if (args.id) {
        const rows = await client.querySportsbook({
          leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
          userState: args.userState || 'tx'
        });
        match = (Array.isArray(rows) ? rows : []).find(row => row && row.id === args.id);
      } else {
        const rows = await client.querySportsbook({
          leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
          userState: args.userState || 'tx'
        });
        const normalizedBook = String(args.book || '').trim().toLowerCase();
        const normalizedParticipant = String(args.participant || '').trim().toLowerCase();
        const normalizedMarket = String(args.market || '').trim().toLowerCase();
        const normalizedSelection = String(args.selection || '').trim().toLowerCase();
        const targetLine = typeof args.line === 'number' ? args.line : Number(args.line);
        const candidates = (Array.isArray(rows) ? rows : []).filter(row => {
          if (!row) return false;
          if (normalizedBook && String(row.book || '').trim().toLowerCase() !== normalizedBook) return false;
          if (normalizedParticipant && String(row.participant || '').trim().toLowerCase() !== normalizedParticipant) return false;
          if (normalizedMarket && String(row.market || '').trim().toLowerCase() !== normalizedMarket) return false;
          if (normalizedSelection && String(row.selection || '').trim().toLowerCase() !== normalizedSelection) return false;
          if (Number.isFinite(targetLine) && Number(row.line) !== targetLine) return false;
          return true;
        });
        if (candidates.length > 1) {
          throw new Error(`Ambiguous +EV row match: found ${candidates.length} rows. Add id or narrow the filters.`);
        }
        match = candidates[0] || null;
      }
      if (!match) {
        throw new Error('+EV row not found for hide request.');
      }
      const payload = await client.hideBet({
        id: match.id,
        gameId: match.gameId,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        market: match.market,
        selectionId: match.selectionId || match.selection,
        selection: match.selection,
        book: match.book,
        odds: match.odds,
        value: match.ev,
        page: '+EV',
        start: match.start
      });
      return { ok: true, matched: match, result: payload };
    },
    async get_hidden_bets() {
      const result = await client.getHiddenBets();
      return { ok: true, result };
    },
    async unhide_bet(args = {}) {
      if (!args.id) {
        throw new Error('id is required');
      }
      const result = await client.unhideBet(args.id);
      return { ok: true, result };
    },
    async clear_hidden_bets() {
      const result = await client.clearHiddenBets();
      return { ok: true, result };
    },
    async health_status() {
      const result = await client.healthStatus();
      return { ok: true, result };
    }
  };
}

function createJsonRpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function createJsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function encodeMessage(payload) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
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
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: error.message || String(error) }],
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

function createStdioMessageReader(onMessage, { allowNewlineJson = process.env.PROPPROFESSOR_MCP_DEBUG_NDJSON === 'true' } = {}) {
  let buffer = '';

  return function onData(chunk) {
    buffer += chunk.toString('utf8');

    while (buffer.length > 0) {
      const separator = '\r\n\r\n';
      const headerEnd = buffer.indexOf(separator);

      if (headerEnd === -1) {
        if (allowNewlineJson) {
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) return;
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) onMessage(JSON.parse(line));
          continue;
        }
        return;
      }

      const headerText = buffer.slice(0, headerEnd);
      const contentLengthLine = headerText
        .split('\r\n')
        .find(line => /^content-length\s*:/i.test(line));
      if (!contentLengthLine) {
        throw new Error('Missing Content-Length header');
      }
      const contentLength = Number(contentLengthLine.split(':').slice(1).join(':').trim());
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        throw new Error(`Invalid Content-Length header: ${contentLengthLine}`);
      }

      const bodyStart = headerEnd + separator.length;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);
      onMessage(JSON.parse(body));
    }
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
