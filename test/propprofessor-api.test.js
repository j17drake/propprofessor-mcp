'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildPropProfessorCookieHeader,
  createPropProfessorClient,
  fetchAccessToken,
  getOddsHistoryStartTimestamp,
  normalizeSelectionId,
  readAuthState
} = require('../lib/propprofessor-api');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');

function makeTempAuthState(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-auth-'));
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return { dir, file };
}

describe('readAuthState', () => {
  it('reads a saved auth.json payload', () => {
    const { dir, file } = makeTempAuthState({ cookies: [{ name: 'x', value: '1' }], origins: [] });

    try {
      const state = readAuthState(file);
      assert.equal(state.cookies.length, 1);
      assert.equal(state.cookies[0].name, 'x');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildPropProfessorCookieHeader', () => {
  it('keeps only propprofessor cookies', () => {
    const header = buildPropProfessorCookieHeader({
      cookies: [
        { domain: '.propprofessor.com', name: 'a', value: '1' },
        { domain: 'app.propprofessor.com', name: 'b', value: '2' },
        { domain: '.google.com', name: 'c', value: '3' },
        { domain: 'notpropprofessor.com', name: 'd', value: '4' }
      ]
    });

    assert.equal(header, 'a=1; b=2');
  });
});

describe('odds-history helpers', () => {
  it('normalizes selection ids from prefixed screen payloads', () => {
    assert.equal(normalizeSelectionId('nba:12345:over'), '12345:over');
    assert.equal(normalizeSelectionId('plain-selection'), 'plain-selection');
    assert.equal(normalizeSelectionId(''), '');
  });

  it('computes a fallback odds-history start timestamp', () => {
    const nowMs = Date.parse('2026-04-20T12:00:00.000Z');
    const ts = getOddsHistoryStartTimestamp({ lookbackHours: 6, nowMs });
    assert.equal(ts, Math.floor((nowMs - (6 * 60 * 60 * 1000)) / 1000));
  });
});

describe('fetchAccessToken', () => {
  it('uses the auth cookies and returns the token payload', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [
        { domain: '.propprofessor.com', name: '__Secure-next-auth.session-token', value: 'abc' },
        { domain: '.example.com', name: 'ignore', value: 'nope' }
      ],
      origins: []
    });

    const calls = [];
    const result = await fetchAccessToken({
      authFile: file,
      gotScrapingImpl: async options => {
        calls.push(options);
        return {
          body: JSON.stringify({
            token: 'jwt-token',
            exp: Math.floor(Date.now() / 1000) + 600,
            perm: { sportsbook: true, fantasy: true }
          }),
          statusCode: 200
        };
      }
    });

    try {
      assert.equal(result.token, 'jwt-token');
      assert.equal(result.perm.sportsbook, true);
      assert.equal(calls.length, 1);
      assert.match(calls[0].headers.Cookie, /__Secure-next-auth\.session-token=abc/);
      assert.equal(calls[0].url, 'https://app.propprofessor.com/api/access-token');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createPropProfessorClient', () => {
  let nowMs;
  beforeEach(() => {
    nowMs = Date.parse('2026-04-20T22:58:00.000Z');
  });

  it('caches access tokens until close to expiry and posts JSON requests with bearer auth', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const tokenCalls = [];
    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async options => {
        tokenCalls.push(options);
        return {
          body: JSON.stringify({
            token: 'jwt-1',
            exp: Math.floor((nowMs + 10 * 60 * 1000) / 1000),
            perm: { sportsbook: true, fantasy: true }
          }),
          statusCode: 200
        };
      },
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: 'row-1', player: 'James Harden' }])
        };
      },
      now: () => nowMs
    });

    try {
      const first = await client.querySportsbook({ leagues: ['NBA'] });
      const second = await client.querySportsbook({ leagues: ['NBA'] });

      assert.equal(tokenCalls.length, 1);
      assert.equal(fetchCalls.length, 2);
      assert.equal(first[0].player, 'James Harden');
      assert.equal(second[0].player, 'James Harden');
      assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer jwt-1');
      assert.equal(fetchCalls[0].options.headers['Content-Type'], 'application/json');
      assert.equal(fetchCalls[0].options.headers.Origin, 'https://app.propprofessor.com');
      assert.equal(fetchCalls[0].options.headers.Referer, 'https://app.propprofessor.com/');
      assert.equal(fetchCalls[0].url, 'https://backend.propprofessor.com/sportsbook');
      assert.equal(JSON.parse(fetchCalls[0].options.body).leagues[0], 'NBA');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts odds screen queries to the screen retrieve endpoint', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-screen',
          exp: Math.floor(Date.now() / 1000) + 600,
          perm: { sportsbook: true }
        }),
        statusCode: 200
      }),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ([{ id: 'row-1', updatedAt: new Date().toISOString() }])
        };
      }
    });

    try {
      const rows = await client.queryScreenOdds({ market: 'Moneyline', league: 'NBA', books: ['FanDuel'] });
      assert.equal(fetchCalls[0].url, 'https://screen.propprofessor.com/api/retrieve-data-new');
      assert.equal(JSON.parse(fetchCalls[0].options.body).books[0], 'FanDuel');
      assert.equal(JSON.parse(fetchCalls[0].options.body).market, 'Moneyline');
      assert.equal(rows[0].id, 'row-1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes screen league casing and applies sharp-book defaults for best comps', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({ token: 'jwt-screen', exp: Math.floor(Date.now() / 1000) + 600, perm: { sportsbook: true } }),
        statusCode: 200
      }),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ game_data: [] }) };
      }
    });

    try {
      await client.queryScreenOdds({ league: 'soccer', market: 'Moneyline' });
      await client.queryScreenOddsBestComps({ league: 'NBA', market: 'Player Points' });
      const firstBody = JSON.parse(fetchCalls[0].options.body);
      const secondBody = JSON.parse(fetchCalls[1].options.body);
      assert.equal(firstBody.league, 'Soccer');
      assert.deepEqual(secondBody.books, ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts odds-history requests with normalized selection ids and derived start timestamp', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const nowMs = Date.parse('2026-04-20T22:58:00.000Z');
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({ token: 'jwt-history', exp: Math.floor(Date.now() / 1000) + 600, perm: { sportsbook: true } }),
        statusCode: 200
      }),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ history: [] }) };
      },
      now: () => nowMs
    });

    try {
      await client.queryOddsHistory({ gameId: 'game-1', selectionId: 'nba:sel-1:over', lookbackHours: 2, sportsbooks: ['Pinnacle'] });
      assert.equal(fetchCalls[0].url, 'https://backend.propprofessor.com/odds_history_new');
      const body = JSON.parse(fetchCalls[0].options.body);
      assert.equal(body.gameId, 'game-1');
      assert.equal(body.selectionId, 'sel-1:over');
      assert.equal(body.startTimestamp, Math.floor((nowMs - (2 * 60 * 60 * 1000)) / 1000));
      assert.deepEqual(body.sportsbooks, ['Pinnacle']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts fantasy queries to the fantasy picks endpoint', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-fantasy',
          exp: Math.floor(Date.now() / 1000) + 600,
          perm: { fantasy: true }
        }),
        statusCode: 200
      }),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ([{ fantasyApp: 'Underdog', ev: 12.3 }])
        };
      }
    });

    try {
      await client.queryFantasyPicks({ fantasyApps: ['Underdog'], minSlipEV: 5 });
      assert.equal(fetchCalls[0].url, 'https://backend.propprofessor.com/fantasy');
      const body = JSON.parse(fetchCalls[0].options.body);
      assert.equal(body.fantasyApps[0], 'Underdog');
      assert.equal(body.minSlipEV, 5);
      assert.equal(body.minOdds, -9999);
      assert.equal(body.maxOdds, 9999);
      assert.equal(body.liveStatus, 'prematch');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refreshes the token once it is near expiry', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const tokenCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async options => {
        tokenCalls.push(options);
        const token = tokenCalls.length === 1 ? 'jwt-1' : 'jwt-2';
        return {
          body: JSON.stringify({
            token,
            exp: Math.floor((nowMs + 5000) / 1000),
            perm: { sportsbook: true }
          }),
          statusCode: 200
        };
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => '[]'
      }),
      now: () => nowMs
    });

    try {
      await client.querySmartMoney({ leagues: ['NBA'] });
      nowMs += 6000;
      await client.querySmartMoney({ leagues: ['NBA'] });

      assert.equal(tokenCalls.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serializes trpc hide payloads with date metadata for superjson', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-hide',
          exp: Math.floor(Date.now() / 1000) + 600,
          perm: { fantasy: true }
        }),
        statusCode: 200
      }),
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }
    });

    try {
      await client.hideBet({ id: 'row-1', start: new Date('2026-04-21T12:00:00.000Z') });
      const parsedInput = JSON.parse(new URL(fetchCalls[0].url).searchParams.get('input'));
      assert.equal(parsedInput['0'].json.start, '2026-04-21T12:00:00.000Z');
      assert.ok(parsedInput['0'].meta);
      assert.ok(Object.keys(parsedInput['0'].meta).length > 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('query_tennis_screen ranks rows from the screen game_data payload', async () => {
    const calls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOdds: async filters => {
          calls.push(filters);
          return {
            game_data: [
              {
                league: 'Tennis',
                book: 'NoVigApp',
                participant: 'Player A',
                market: 'Moneyline',
                value: 3.2,
                odds: 110
              }
            ]
          };
        }
      }
    });

    const result = await handlers.query_tennis_screen({ market: 'Moneyline', limit: 5 });
    assert.equal(result.ok, true);
    assert.equal(Array.isArray(result.result), true);
    assert.equal(result.result.length, 1);
    assert.equal(result.result[0].participant, 'Player A');
    assert.deepEqual(calls[0].books, ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa']);
  });

  it('returns tennis ranking explanations and score breakdowns', async () => {
    const handlers = createMcpHandlers({
      client: {
        queryScreenOdds: async () => ({
          game_data: [
            {
              league: 'Tennis',
              book: 'NoVigApp',
              participant: 'Player A',
              market: 'Moneyline',
              value: 2.5,
              odds: 120,
              lineHistory: [130, 120],
              oddsHistory: [130, 120],
              selections: {
                a: {
                  selection1: 'Player A',
                  selection2: 'Player B',
                  odds: {
                    NoVigApp: { odds1: 120, odds2: -130 },
                    Polymarket: { odds1: 110, odds2: -120 },
                    Kalshi: { odds1: 105, odds2: -125 },
                    BetOnline: { odds1: 115, odds2: -118 },
                    Circa: { odds1: 112, odds2: -122 }
                  }
                }
              },
              defaultKey: 'a'
            }
          ]
        })
      }
    });

    const result = await handlers.query_tennis_screen({ market: 'Moneyline', limit: 5 });
    assert.equal(result.result[0].hasConsensus, true);
    assert.equal(result.result[0].hasLineMovement, true);
    assert.equal(typeof result.result[0].rankingReason, 'string');
    assert.ok(result.result[0].rankingReason.includes('consensus edge'));
    assert.equal(typeof result.result[0].scoreBreakdown, 'object');
    assert.equal(typeof result.result[0].scoreBreakdown.total, 'number');
  });

  it('healthStatus reports screen endpoint status and errors only', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({ token: 'jwt-health', exp: Math.floor(Date.now() / 1000) + 600, perm: { sportsbook: true } }),
        statusCode: 200
      }),
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'backend down' })
    });

    try {
      const result = await client.healthStatus();
      assert.equal(result.ok, false);
      assert.deepEqual(result.endpoints, { screen: 'error' });
      assert.match(result.errors.screen, /503/);
      assert.equal(result.freshness.screen.rowCount, 0);
      assert.equal('fantasy' in result.endpoints, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sorts fantasy rows by value descending', async () => {
    const { dir, file } = makeTempAuthState({ cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie' }], origins: [] });
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ id: 'a', value: 1 }, { id: 'b', value: 3 }] })
    });

    try {
      const rows = await client.queryFantasyPicksSorted({});
      assert.equal(rows[0].id, 'b');
      assert.equal(rows[1].id, 'a');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not retry non-retryable HTTP client errors', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    let fetchAttempts = 0;
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => {
        fetchAttempts += 1;
        return { ok: false, status: 401, text: async () => 'unauthorized' };
      },
      retryDelaysMs: [0, 0]
    });

    try {
      await assert.rejects(() => client.queryScreenOdds({}), /401/);
      assert.equal(fetchAttempts, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retries retryable rate-limit responses', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    let fetchAttempts = 0;
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => {
        fetchAttempts += 1;
        if (fetchAttempts < 3) {
          return { ok: false, status: 429, text: async () => 'rate limited' };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
      retryDelaysMs: [0, 0]
    });

    try {
      const result = await client.queryScreenOdds({});
      assert.deepEqual(result, { ok: true });
      assert.equal(fetchAttempts, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
