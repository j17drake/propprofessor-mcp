'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const packageJson = require('../package.json');
const {
  createMcpHandlers,
  createMcpServer,
  createStdioMessageReader
} = require('../scripts/propprofessor-mcp-server');

const serverPath = path.join(__dirname, '..', 'scripts', 'propprofessor-mcp-server.js');

function makeEmptyScreenPayload() {
  return { game_data: [] };
}

function createRankedScreenClientStub({
      rankedPayload = {
        game_data: [{
          gameId: 'stub-game-1',
          league: 'NBA',
          market: 'Moneyline',
          updatedAt: new Date(Date.now() - 30 * 1000).toISOString(),
          homeTeam: 'Stub Home',
          awayTeam: 'Stub Away',
          selections: {
            a: {
              selection1: 'Stub Home',
              participant1: 'Stub Home',
              selection1Id: 'Moneyline:Stub_Home',
              selection2: 'Stub Away',
              participant2: 'Stub Away',
              selection2Id: 'Moneyline:Stub_Away',
              odds: {
                NoVigApp: { odds1: -118, odds2: 104 },
                Polymarket: { odds1: -125, odds2: 110 }
              }
            }
          },
          defaultKey: 'a'
        }]
      },
  rawPayload = { ok: true, rows: [] },
  healthPayload = { ok: true, screen: { reachable: true } }
} = {}) {
  const calls = {
    queryScreenOdds: [],
    queryScreenOddsBestComps: [],
    healthStatus: 0
  };

  return {
    calls,
    client: {
      queryScreenOdds: async filters => {
        calls.queryScreenOdds.push(filters);
        return rawPayload;
      },
      queryScreenOddsBestComps: async filters => {
        calls.queryScreenOddsBestComps.push(filters);
        return rankedPayload;
      },
      queryOddsHistory: async () => ({
        NoVigApp: [{ odds: -118, start_ts: 1 }, { odds: -130, start_ts: 2 }],
        Polymarket: [{ odds: -125, start_ts: 3 }]
      }),
      healthStatus: async () => {
        calls.healthStatus += 1;
        return healthPayload;
      }
    }
  };
}

function assertBasicRankedResponse(result, expectedLeague) {
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.result));
  assert.equal(result.league, expectedLeague);
}

function createJsonRpcMessage(id, method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function waitForJsonRpcMessage(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response. Buffer: ${buffer.slice(0, 500)}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onStderr);
      proc.off('exit', onExit);
    }

    function maybeParse() {
      const separator = '\r\n\r\n';
      const headerEnd = buffer.indexOf(separator);
      if (headerEnd === -1) return null;
      const headerText = buffer.slice(0, headerEnd);
      const headers = {};
      for (const line of headerText.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      const contentLength = Number(headers['content-length'] || 0);
      const bodyStart = headerEnd + separator.length;
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        throw new Error(`Invalid Content-Length header: ${headers['content-length'] || '<missing>'}`);
      }
      if (buffer.length < bodyStart + contentLength) return null;
      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);
      return JSON.parse(body);
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      try {
        const message = maybeParse();
        if (message) {
          cleanup();
          resolve(message);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }

    function onStderr(chunk) {
      buffer += `\n[stderr] ${chunk.toString('utf8')}`;
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`MCP server exited early with code ${code}. Buffer: ${buffer.slice(0, 500)}`));
    }

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onStderr);
    proc.on('exit', onExit);
  });
}

function waitForNdjsonMessage(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for NDJSON MCP response. Buffer: ${buffer.slice(0, 500)}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onStderr);
      proc.off('exit', onExit);
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) return;
      cleanup();
      resolve(JSON.parse(line));
    }

    function onStderr(chunk) {
      buffer += `\n[stderr] ${chunk.toString('utf8')}`;
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`MCP server exited early with code ${code}. Buffer: ${buffer.slice(0, 500)}`));
    }

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onStderr);
    proc.on('exit', onExit);
  });
}

describe('propprofessor MCP server stdio contract', () => {
  // Direct smoke coverage checklist for public MCP tools:
  // covered: query_screen_odds, query_screen_odds_best_comps, query_screen_odds_ranked,
  // query_sport_screen, query_nba_screen, query_wnba_screen, query_mlb_screen,
  // query_nfl_screen, query_nhl_screen, query_soccer_screen, query_ncaab_screen,
  // query_ncaaf_screen, query_tennis_screen, league_presets, health_status.
  it('responds to initialize and lists the expected tools', async () => {
    const proc = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    try {
      proc.stdin.write(createJsonRpcMessage(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }));

      const initializeResponse = await waitForJsonRpcMessage(proc);
      assert.equal(initializeResponse.id, 1);
      assert.equal(initializeResponse.jsonrpc, '2.0');
      assert.equal(initializeResponse.result.serverInfo.name, 'propprofessor');
      assert.equal(initializeResponse.result.serverInfo.version, packageJson.version);
      assert.ok(initializeResponse.result.capabilities.tools);

      proc.stdin.write(createJsonRpcMessage(2, 'tools/list', {}));
      const toolsResponse = await waitForJsonRpcMessage(proc);
      assert.equal(toolsResponse.id, 2);
      const toolNames = toolsResponse.result.tools.map(tool => tool.name).sort();
      assert.deepEqual(toolNames, [
        'health_status',
        'league_presets',
        'query_mlb_screen',
        'query_nba_screen',
        'query_ncaab_screen',
        'query_ncaaf_screen',
        'query_nfl_screen',
        'query_nhl_screen',
        'query_screen_odds',
        'query_screen_odds_best_comps',
        'query_screen_odds_ranked',
        'query_soccer_screen',
        'query_sport_screen',
        'query_tennis_screen',
        'query_wnba_screen'
      ]);
    } finally {
      proc.kill('SIGTERM');
    }
  });

  it('supports NDJSON initialize and tools/list framing when enabled', async () => {
    const proc = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PROPPROFESSOR_MCP_NDJSON: 'true' }
    });

    try {
      proc.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      }) + '\n');

      const initializeResponse = await waitForNdjsonMessage(proc);
      assert.equal(initializeResponse.id, 1);
      assert.equal(initializeResponse.result.serverInfo.name, 'propprofessor');

      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      const toolsResponse = await waitForNdjsonMessage(proc);
      assert.equal(toolsResponse.id, 2);
      assert.ok(Array.isArray(toolsResponse.result.tools));
      assert.ok(toolsResponse.result.tools.length > 0);
    } finally {
      proc.kill('SIGTERM');
    }
  });

  it('returns server not initialized for tools/call before initialize', async () => {
    const server = createMcpServer({
      handlers: {
        query_screen_odds: async () => ({ ok: true })
      },
      toolDefinitions: [{
        name: 'query_screen_odds',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      }]
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'query_screen_odds', arguments: {} }
    });

    assert.equal(response.error.code, -32002);
    assert.equal(response.error.message, 'Server not initialized');
  });

  it('ignores notifications/initialized without breaking the session', async () => {
    const server = createMcpServer();

    const initializeResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
    });
    assert.equal(initializeResponse.result.serverInfo.name, 'propprofessor');

    const notificationResponse = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    assert.equal(notificationResponse, null);

    const toolsResponse = await server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.ok(Array.isArray(toolsResponse.result.tools));
    assert.ok(toolsResponse.result.tools.length > 0);
  });

  it('returns structured categorized errors for failed tool calls', async () => {
    const server = createMcpServer({
      handlers: {
        fail_tool: async () => {
          const error = new Error('Missing PropProfessor auth token');
          error.code = 'AUTH_REQUIRED';
          error.category = 'auth';
          error.status = 401;
          throw error;
        }
      },
      toolDefinitions: [{
        name: 'fail_tool',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      }]
    });

    await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
    const response = await server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fail_tool', arguments: {} } });

    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.ok, false);
    assert.deepEqual(response.result.structuredContent.error, {
      code: 'AUTH_REQUIRED',
      message: 'Missing PropProfessor auth token',
      category: 'auth',
      status: 401
    });
  });

  it('classifies malformed Content-Length frames as transport errors', () => {
    const messages = [];
    const reader = createStdioMessageReader(message => {
      messages.push(message);
    });

    assert.throws(() => {
      reader(Buffer.from('Content-Length: nope\r\n\r\n{"jsonrpc":"2.0"}', 'utf8'));
    }, error => {
      assert.equal(error.code, 'INVALID_MCP_FRAME');
      assert.equal(error.category, 'transport');
      assert.match(error.message, /Invalid Content-Length header/);
      return true;
    });
    assert.deepEqual(messages, []);
  });

  it('query_screen_odds returns the raw screen payload', async () => {
    const payload = { ok: true, rows: [{ id: 'raw-row' }] };
    const { client, calls } = createRankedScreenClientStub({ rawPayload: payload });
    const handlers = createMcpHandlers({ client });

    const result = await handlers.query_screen_odds({
      league: 'NBA',
      market: 'Moneyline',
      books: ['Pinnacle'],
      participants: ['Lakers'],
      games: ['game-1']
    });

    assert.equal(calls.queryScreenOdds.length, 1);
    assert.deepEqual(calls.queryScreenOdds[0], {
      market: 'Moneyline',
      league: 'NBA',
      games: ['game-1'],
      participants: ['Lakers'],
      books: ['Pinnacle'],
      is_live: false
    });
    assert.deepEqual(result, { ok: true, result: payload });
  });

  it('query_screen_odds_best_comps returns derived sharp-book metadata for NBA props', async () => {
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => ({ ok: true, filters }),
        queryOddsHistory: async () => ({})
      }
    });

    const result = await handlers.query_screen_odds_best_comps({ league: 'NBA', market: 'Player Points' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.comparisonBooks, ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle']);
    assert.equal(result.sharpBookResearch.key, 'nba_props');
  });

  it('league presets expose sharpMainMarkets and sharpProps labels', async () => {
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => ({ ok: true, filters }),
        queryOddsHistory: async () => ({})
      }
    });

    const presets = await handlers.league_presets();
    const nba = presets.result.find(entry => entry.league === 'NBA');
    const wnba = presets.result.find(entry => entry.league === 'WNBA');
    const nfl = presets.result.find(entry => entry.league === 'NFL');
    const mlb = presets.result.find(entry => entry.league === 'MLB');

    assert.ok(wnba);
    assert.equal(wnba.displayName, 'WNBA');

    assert.deepEqual(nba.sharpMainMarkets, ['Circa', 'Pinnacle', 'BookMaker', 'BetOnline', 'DraftKings']);
    assert.deepEqual(nba.sharpProps, ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle']);
    assert.deepEqual(nfl.sharpMainMarkets, ['Circa', 'Pinnacle', 'BookMaker', 'NoVigApp', 'FanDuel']);
    assert.deepEqual(nfl.sharpProps, ['Pinnacle', 'FanDuel', 'BookMaker', 'Circa', 'BetOnline']);
    assert.deepEqual(mlb.sharpMainMarkets, ['Pinnacle', 'Circa', 'BookMaker', 'BetOnline', 'DraftKings', 'BetMGM']);
    assert.deepEqual(mlb.sharpProps, ['Circa', 'FanDuel', 'PropBuilder', 'Pinnacle', 'DraftKings', 'Bet365']);
  });

  for (const { toolName, league } of [
    { toolName: 'query_nba_screen', league: 'NBA' },
    { toolName: 'query_wnba_screen', league: 'WNBA' },
    { toolName: 'query_mlb_screen', league: 'MLB' },
    { toolName: 'query_nfl_screen', league: 'NFL' },
    { toolName: 'query_nhl_screen', league: 'NHL' },
    { toolName: 'query_ncaab_screen', league: 'NCAAB' },
    { toolName: 'query_ncaaf_screen', league: 'NCAAF' }
  ]) {
    it(`${toolName} returns a structured ranked response`, async () => {
      const { client, calls } = createRankedScreenClientStub();
      const handlers = createMcpHandlers({ client });

      const result = await handlers[toolName]({ market: 'Moneyline', books: ['Pinnacle'], includeAll: true });

      assert.equal(calls.queryScreenOddsBestComps.length, 1);
      assert.equal(calls.queryScreenOddsBestComps[0].league, league);
      assert.equal(calls.queryScreenOddsBestComps[0].market, 'Moneyline');
      assert.deepEqual(calls.queryScreenOddsBestComps[0].books, ['Pinnacle']);
      assertBasicRankedResponse(result, league);
    });
  }

  it('query_screen_odds_ranked returns a structured ranked response', async () => {
    const rankedPayload = {
      game_data: [{
        gameId: 'game-1',
        league: 'NBA',
        market: 'Moneyline',
        updatedAt: new Date(Date.now() - 30 * 1000).toISOString(),
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        selections: {
          a: {
            selection1: 'Lakers',
            participant1: 'Lakers',
            selection1Id: 'Moneyline:Lakers',
            selection2: 'Warriors',
            participant2: 'Warriors',
            selection2Id: 'Moneyline:Warriors',
            odds: {
              NoVigApp: { odds1: -118, odds2: 104 },
              Polymarket: { odds1: -125, odds2: 110 }
            }
          }
        },
        defaultKey: 'a'
      }]
    };
    const { client, calls } = createRankedScreenClientStub({ rankedPayload });
    const handlers = createMcpHandlers({ client });

    const result = await handlers.query_screen_odds_ranked({ league: 'NBA', market: 'Moneyline', includeAll: true, books: ['NoVigApp'] });

    assert.equal(calls.queryScreenOddsBestComps.length, 1);
    assert.equal(calls.queryScreenOddsBestComps[0].league, 'NBA');
    assert.equal(calls.queryScreenOddsBestComps[0].market, 'Moneyline');
    assertBasicRankedResponse(result, 'NBA');
    assert.equal(result.result[0].movementMode, 'same_book');
    assert.equal(result.result[0].movementSourceBook, 'NoVigApp');
    assert.equal(Array.isArray(result.result[0].historySportsbooksRequested), true);
  });

  it('query_sport_screen routes non-tennis leagues through the ranked league flow', async () => {
    const { client, calls } = createRankedScreenClientStub();
    const handlers = createMcpHandlers({ client });

    const result = await handlers.query_sport_screen({ league: 'WNBA', market: 'Moneyline', includeAll: true });

    assert.equal(calls.queryScreenOddsBestComps.length, 1);
    assert.equal(calls.queryScreenOddsBestComps[0].league, 'WNBA');
    assertBasicRankedResponse(result, 'WNBA');
  });

  it('query_sport_screen routes tennis through the tennis-specific query path', async () => {
    const { client, calls } = createRankedScreenClientStub();
    const handlers = createMcpHandlers({ client });

    const result = await handlers.query_sport_screen({ league: 'Tennis', market: 'Moneyline', book: 'Pinnacle', includeAll: true });

    assert.ok(calls.queryScreenOdds.length >= 1);
    assert.equal(calls.queryScreenOddsBestComps.length, 0);
    for (const call of calls.queryScreenOdds) {
      assert.equal(call.league, 'Tennis');
    }
    assertBasicRankedResponse(result, 'Tennis');
  });

  it('query_tennis_screen uses Tennis queries and carries the preferred book into the request set', async () => {
    const { client, calls } = createRankedScreenClientStub();
    const handlers = createMcpHandlers({ client });

    const result = await handlers.query_tennis_screen({ market: 'Moneyline', book: 'Pinnacle', includeAll: true });

    assert.ok(calls.queryScreenOdds.length >= 1);
    for (const call of calls.queryScreenOdds) {
      assert.equal(call.league, 'Tennis');
      assert.ok(call.books.includes('Pinnacle'));
    }
    assertBasicRankedResponse(result, 'Tennis');
  });

  it('health_status returns the client health payload', async () => {
    const healthPayload = { ok: true, screen: { reachable: true } };
    const { client, calls } = createRankedScreenClientStub({ healthPayload });
    const handlers = createMcpHandlers({ client });

    const result = await handlers.health_status();

    assert.equal(calls.healthStatus, 1);
    assert.deepEqual(result, { ok: true, result: healthPayload });
  });

  it('query_screen_odds_best_comps returns derived sharp-book metadata for MLB props', async () => {
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => ({ ok: true, filters }),
        queryOddsHistory: async () => ({})
      }
    });

    const result = await handlers.query_screen_odds_best_comps({ league: 'MLB', market: 'Player Strikeouts' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.comparisonBooks, ['Circa', 'FanDuel', 'PropBuilder', 'Pinnacle', 'DraftKings', 'Bet365']);
    assert.equal(result.sharpBookResearch.key, 'mlb_props');
  });

  it('query_soccer_screen sends the backend-supported Soccer league casing', async () => {
    const calls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => {
          calls.push(filters);
          return { game_data: [] };
        },
        queryOddsHistory: async () => ({})
      }
    });

    const result = await handlers.query_soccer_screen({ market: 'Moneyline', books: ['NoVigApp'], includeAll: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'Soccer');
    assert.equal(calls[0].market, 'Moneyline');
    assert.equal(result.ok, true);
  });
});
