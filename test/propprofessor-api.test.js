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
  normalizeSelectionId,
  readAuthState
} = require('../lib/propprofessor-api');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { getLookbackHours, DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('../lib/propprofessor-mcp-ranked-screen');

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

describe('normalizeSelectionId', () => {
  it('strips a sportsbook prefix when the id has more than two colon-delimited parts', () => {
    assert.equal(
      normalizeSelectionId('Rebet:Point_Spread:San_Antonio_Spurs_-5.5'),
      'Point_Spread:San_Antonio_Spurs_-5.5'
    );
    assert.equal(
      normalizeSelectionId('DraftKings:Player_Points:Jalen_Brunson_26.5'),
      'Player_Points:Jalen_Brunson_26.5'
    );
  });

  it('leaves already-normalized ids unchanged', () => {
    assert.equal(
      normalizeSelectionId('Point_Spread:San_Antonio_Spurs_-5.5'),
      'Point_Spread:San_Antonio_Spurs_-5.5'
    );
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

  it('mentions the resolved auth file path when no PropProfessor cookies are present', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.example.com', name: 'ignore', value: 'nope' }],
      origins: []
    });

    try {
      await assert.rejects(
        fetchAccessToken({ authFile: file }),
        error => {
          assert.match(error.message, /No PropProfessor cookies found/);
          assert.match(error.message, new RegExp(path.escape ? path.escape(file) : file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          return true;
        }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ranked screen lookback defaults', () => {
  it('uses the shared default lookback when args omit lookbackHours', () => {
    assert.equal(getLookbackHours({}), DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS);
  });

  it('keeps explicit lookbackHours overrides', () => {
    assert.equal(getLookbackHours({ lookbackHours: 8 }), 8);
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

  it('normalizes screen league names to the backend-supported casing', async () => {
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
          json: async () => ([])
        };
      }
    });

    try {
      await client.queryScreenOdds({ market: 'Moneyline', league: 'SOCCER', books: ['NoVigApp'] });
      await client.queryScreenOdds({ market: 'Moneyline', league: 'TENNIS', books: ['NoVigApp'] });
      await client.queryScreenOddsBestComps({ market: 'Moneyline', league: 'SOCCER' });
      const first = JSON.parse(fetchCalls[0].options.body);
      const second = JSON.parse(fetchCalls[1].options.body);
      const third = JSON.parse(fetchCalls[2].options.body);
      assert.equal(first.league, 'Soccer');
      assert.equal(second.league, 'Tennis');
      assert.equal(third.league, 'Soccer');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('queryScreenOddsBestComps keeps default books when books is omitted, but allows explicit undefined to pass through', async () => {
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
          json: async () => ([])
        };
      }
    });

    try {
      await client.queryScreenOddsBestComps({ market: 'Moneyline', league: 'NBA' });
      await client.queryScreenOddsBestComps({ market: 'Player Points', league: 'NBA' });
      await client.queryScreenOddsBestComps({ market: 'Moneyline', league: 'NBA', books: [] });
      const first = JSON.parse(fetchCalls[0].options.body);
      const second = JSON.parse(fetchCalls[1].options.body);
      const third = JSON.parse(fetchCalls[2].options.body);
      assert.deepEqual(first.books, ['Circa', 'Pinnacle', 'BookMaker', 'BetOnline', 'DraftKings']);
      assert.deepEqual(second.books, ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle']);
      assert.deepEqual(third.books, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not expose the removed fantasy query helpers on the screen-only client', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-screen-only',
          exp: Math.floor(Date.now() / 1000) + 600,
          perm: { sportsbook: true }
        }),
        statusCode: 200
      })
    });

    try {
      assert.equal(typeof client.queryFantasyPicks, 'undefined');
      assert.equal(typeof client.queryFantasyPicksSorted, 'undefined');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts odds-history queries to the backend odds history endpoint', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-history',
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
          json: async () => ({ FanDuel: [{ odds: -110, start_ts: 1 }, { odds: -120, start_ts: 2 }] })
        };
      }
    });

    try {
      const payload = await client.queryOddsHistory({
        gameId: 'game-1',
        selectionId: 'Rebet:Point_Spread:San_Antonio_Spurs_-5.5',
        sportsbooks: ['Rebet'],
        startTimestamp: 123
      });
      assert.equal(fetchCalls[0].url, 'https://backend.propprofessor.com/odds_history_new');
      const body = JSON.parse(fetchCalls[0].options.body);
      assert.equal(body.gameId, 'game-1');
      assert.equal(body.selectionId, 'Point_Spread:San_Antonio_Spurs_-5.5');
      assert.deepEqual(body.sportsbooks, ['Rebet']);
      assert.equal(body.startTimestamp, 123);
      assert.equal(payload.FanDuel[0].odds, -110);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns screen-only health status when the screen endpoint fails', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const fetchCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-health',
          exp: Math.floor(Date.now() / 1000) + 600,
          perm: { sportsbook: true, fantasy: true }
        }),
        statusCode: 200
      }),
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        return {
          ok: false,
          status: 500,
          text: async () => 'screen failed'
        };
      },
      retryDelaysMs: [0]
    });

    try {
      const health = await client.healthStatus();
      assert.equal(health.ok, false);
      assert.equal(health.endpoints.screen, 'error');
      assert.equal('fantasy' in health.endpoints, false);
      assert.match(health.errors.screen, /500|screen failed/);
      assert.equal('fantasy' in health.errors, false);
      assert.equal('fantasy' in health.freshness, false);
      assert.equal(fetchCalls.length, 2);
      assert.ok(fetchCalls.every(url => /\/screen/.test(url)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('healthStatus reports non-null freshness ages and timestamp sources for screen rows', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });

    const nowMs = Date.parse('2026-04-20T22:58:00.000Z');
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({
        body: JSON.stringify({
          token: 'jwt-health-rows',
          exp: Math.floor(nowMs / 1000) + 600,
          perm: { sportsbook: true }
        }),
        statusCode: 200
      }),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          game_data: [
            { id: 'row-1', updatedAt: new Date(nowMs - 12 * 1000).toISOString() },
            { id: 'row-2', payload: { updatedAt: new Date(nowMs - 40 * 1000).toISOString() } },
            { id: 'row-3', meta: { timestamp: new Date(nowMs - 25 * 1000).toISOString() } }
          ]
        })
      }),
      now: () => nowMs
    });

    try {
      const health = await client.healthStatus();
      assert.equal(health.ok, true);
      assert.equal(health.freshness.screen.rowCount, 3);
      assert.equal(health.freshness.screen.newestAgeMs, 12000);
      assert.equal(health.freshness.screen.oldestAgeMs, 40000);
      assert.equal(health.freshness.screen.freshnessFallbackUsed, false);
      assert.deepEqual(health.freshness.screen.timestampSources, {
        updatedAt: 1,
        'payload.updatedAt': 1,
        'meta.timestamp': 1
      });
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

  it('query_nba_screen expands nested /screen rows before ranking', async () => {
    const calls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => {
          calls.push(filters);
          return {
            game_data: [{
              gameId: 'game-1',
              league: 'NBA',
              market: 'Point Spread',
              homeTeam: 'Houston Rockets',
              awayTeam: 'Los Angeles Lakers',
              selections: {
                '-2.5': {
                  selection1: 'Houston Rockets -2.5',
                  participant1: 'Houston Rockets',
                  selection1Id: 'Point_Spread:Houston_Rockets_-2.5',
                  line1: -2.5,
                  selection2: 'Los Angeles Lakers +2.5',
                  participant2: 'Los Angeles Lakers',
                  selection2Id: 'Point_Spread:Los_Angeles_Lakers_+2.5',
                  line2: 2.5,
                  odds: {
                    NoVigApp: { odds1: -128, odds2: 104 },
                    Polymarket: { odds1: -126, odds2: 102 }
                  }
                }
              }
            }]
          };
        },
        queryOddsHistory: async ({ gameId, selectionId }) => ({
          NoVigApp: String(selectionId).includes('Houston_Rockets')
            ? [{ odds: -128, start_ts: 1 }, { odds: -140, start_ts: 2 }]
            : [{ odds: 104, start_ts: 1 }, { odds: 116, start_ts: 2 }],
          Polymarket: [{ odds: -126, start_ts: 3 }],
          meta: { gameId }
        })
      }
    });

    const result = await handlers.query_nba_screen({ market: 'Point Spread', books: ['NoVigApp'] });
    assert.equal(result.ok, true);
    assert.equal(result.result.length >= 1, true);
    assert.equal(result.result[0].book, 'NoVigApp');
    assert.equal(result.result[0].selectionId, 'Point_Spread:Houston_Rockets_-2.5');
    assert.equal(result.result[0].lineHistoryAvailable, true);
    assert.equal(result.result[0].lineHistorySource, 'odds_history');
    assert.equal(result.result[0].historyGameId, 'game-1');
    assert.equal(result.result[0].normalizedSelectionId, 'Point_Spread:Houston_Rockets_-2.5');
    assert.equal(result.result[0].historyMatchedBy, 'selectionId');
    assert.equal(Array.isArray(result.result[0].lineHistory), true);
    assert.equal(result.result[0].lineHistory.length >= 2, true);
    assert.equal(typeof result.result[0].clvProxyPct, 'number');
    assert.equal(result.result[0].hasLineMovement, true);
    assert.deepEqual(calls[0].books, ['NoVigApp']);
  });

  it('query_screen_odds_ranked uses the shared ranked screen flow with hydration and freshness', async () => {
    const screenCalls = [];
    const historyCalls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => {
          screenCalls.push(filters);
          return {
            game_data: [{
              gameId: 'game-ranked-1',
              league: 'NBA',
              market: 'Moneyline',
              updatedAt: new Date(Date.now() - 30 * 1000).toISOString(),
              homeTeam: 'Boston Celtics',
              awayTeam: 'Miami Heat',
              selections: {
                a: {
                  selection1: 'Boston Celtics',
                  participant1: 'Boston Celtics',
                  selection1Id: 'Moneyline:Boston_Celtics',
                  selection2: 'Miami Heat',
                  participant2: 'Miami Heat',
                  selection2Id: 'Moneyline:Miami_Heat',
                  odds: {
                    NoVigApp: { odds1: -142, odds2: 122 },
                    Polymarket: { odds1: -150, odds2: 128 }
                  }
                }
              },
              defaultKey: 'a'
            }]
          };
        },
        queryOddsHistory: async ({ gameId, selectionId, sportsbooks }) => {
          historyCalls.push({ gameId, selectionId, sportsbooks });
          return {
            NoVigApp: String(selectionId).includes('Boston_Celtics')
              ? [{ odds: -142, start_ts: 1 }, { odds: -155, start_ts: 2 }]
              : [{ odds: 122, start_ts: 1 }, { odds: 135, start_ts: 2 }],
            Polymarket: [{ odds: -150, start_ts: 3 }],
            meta: { gameId }
          };
        }
      }
    });

    const result = await handlers.query_screen_odds_ranked({ league: 'NBA', market: 'Moneyline', books: ['NoVigApp'], lookbackHours: 6 });
    assert.equal(result.ok, true);
    assert.equal(result.freshness.rowCount, 2);
    assert.equal(result.freshness.newestAgeMs !== null, true);
    assert.equal(result.resultMeta.lookbackHoursUsed, 6);
    assert.deepEqual(result.resultMeta.historySportsbooksRequested, ['NoVigApp']);
    assert.equal(result.resultMeta.debugEnabled, true);
    assert.equal(result.resultMeta.freshnessFallbackUsed, false);
    assert.deepEqual(result.resultMeta.timestampSources, { updatedAt: 2 });
    assert.equal(result.result[0].lineHistoryAvailable, true);
    assert.equal(result.result[0].lineHistorySource, 'odds_history');
    assert.equal(result.result[0].historyGameId, 'game-ranked-1');
    assert.equal(result.result[0].normalizedSelectionId, 'Moneyline:Boston_Celtics');
    assert.equal(result.result[0].historyMatchedBy, 'selectionId');
    assert.equal(result.result[0].lineHistoryLookbackHours, 6);
    assert.equal(result.result[0].freshnessSource, 'updatedAt');
    assert.equal(result.result[0].freshnessFallbackUsed, false);
    assert.equal(typeof result.result[0].freshnessAgeMs, 'number');
    assert.equal(typeof result.result[0].clvProxyPct, 'number');
    assert.equal(result.result[0].movementMode, 'same_book');
    assert.equal(result.result[0].movementSourceBook, 'NoVigApp');
    assert.equal(result.result[0].lineHistoryUsable, true);
    assert.equal(Array.isArray(result.result[0].historySportsbooksRequested), true);
    assert.equal(typeof result.result[0].movementDebug, 'object');
    assert.equal(Array.isArray(result.result[0].filteredLineHistory), true);
    assert.equal(typeof result.result[0].droppedHistoryReasons, 'object');
    assert.equal(typeof result.result[0].openToCurrentClvPct, 'number');
    assert.equal(result.result[0].rankingProvenance.focusBook, 'NoVigApp');
    assert.equal(result.result[0].rankingProvenance.historyMatchedBy, 'selectionId');
    assert.equal(result.result[0].rankingProvenance.lineHistorySource, 'odds_history');
    assert.equal(result.result[0].rankingProvenance.normalizedSelectionId, 'Moneyline:Boston_Celtics');
    assert.deepEqual(screenCalls[0].books, ['NoVigApp']);
    assert.equal(historyCalls.length >= 1, true);
    assert.deepEqual(historyCalls[0].sportsbooks, ['NoVigApp']);
  });

  it('query_screen_odds_ranked omits verbose movement debug when disabled', async () => {
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async () => ({
          game_data: [{
            gameId: 'game-ranked-2',
            league: 'NBA',
            market: 'Moneyline',
            updatedAt: new Date(Date.now() - 20 * 1000).toISOString(),
            homeTeam: 'Cleveland Cavaliers',
            awayTeam: 'Detroit Pistons',
            selections: {
              a: {
                selection1: 'Cleveland Cavaliers',
                participant1: 'Cleveland Cavaliers',
                selection1Id: 'Moneyline:Cleveland_Cavaliers',
                selection2: 'Detroit Pistons',
                participant2: 'Detroit Pistons',
                selection2Id: 'Moneyline:Detroit_Pistons',
                odds: {
                  NoVigApp: { odds1: -130, odds2: 110 },
                  Polymarket: { odds1: -138, odds2: 118 }
                }
              }
            },
            defaultKey: 'a'
          }]
        }),
        queryOddsHistory: async ({ gameId }) => ({
          NoVigApp: [{ odds: -125, start_ts: 1 }, { odds: -130, start_ts: 2 }],
          meta: { gameId }
        })
      }
    });

    const result = await handlers.query_screen_odds_ranked({ league: 'NBA', market: 'Moneyline', books: ['NoVigApp'], debug: false });

    assert.equal(result.resultMeta.debugEnabled, false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.result[0], 'movementDebug'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.result[0], 'filteredLineHistory'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.result[0], 'droppedHistoryReasons'), false);
    assert.ok(result.result[0].rankingProvenance);
  });

  it('query_sport_screen reuses the ranked league flow for non-tennis leagues', async () => {
    const screenCalls = [];
    const historyCalls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOddsBestComps: async filters => {
          screenCalls.push(filters);
          return {
            game_data: [{
              gameId: 'game-sport-1',
              league: 'NBA',
              market: 'Moneyline',
              updatedAt: new Date(Date.now() - 45 * 1000).toISOString(),
              homeTeam: 'Knicks',
              awayTeam: 'Pacers',
              selections: {
                a: {
                  selection1: 'Knicks',
                  participant1: 'Knicks',
                  selection1Id: 'Moneyline:Knicks',
                  selection2: 'Pacers',
                  participant2: 'Pacers',
                  selection2Id: 'Moneyline:Pacers',
                  odds: {
                    NoVigApp: { odds1: -118, odds2: 104 },
                    Polymarket: { odds1: -125, odds2: 110 }
                  }
                }
              },
              defaultKey: 'a'
            }]
          };
        },
        queryOddsHistory: async ({ gameId, selectionId }) => {
          historyCalls.push({ gameId, selectionId });
          return {
            NoVigApp: [{ odds: -130, start_ts: 1 }, { odds: String(selectionId).includes('Knicks') ? -118 : 104, start_ts: 2 }],
            Polymarket: [{ odds: -125, start_ts: 3 }],
            meta: { gameId }
          };
        }
      }
    });

    const result = await handlers.query_sport_screen({ league: 'nba', market: 'Moneyline', books: ['NoVigApp'], lookbackHours: 8 });
    assert.equal(result.ok, true);
    assert.equal(result.league, 'NBA');
    assert.equal(result.freshness.rowCount, 2);
    assert.equal(result.result[0].leaguePreset, 'NBA');
    assert.equal(result.result[0].lineHistoryAvailable, true);
    assert.equal(result.result[0].lineHistorySource, 'odds_history');
    assert.equal(result.result[0].historyGameId, 'game-sport-1');
    assert.equal(result.result[0].normalizedSelectionId, 'Moneyline:Knicks');
    assert.equal(result.result[0].historyMatchedBy, 'selectionId');
    assert.equal(result.result[0].lineHistoryLookbackHours, 8);
    assert.equal(screenCalls[0].league, 'NBA');
    assert.equal(historyCalls.length >= 1, true);
  });

  it('query_tennis_screen hydrates missing line history through the shared ranked flow', async () => {
    const screenCalls = [];
    const historyCalls = [];
    const handlers = createMcpHandlers({
      client: {
        queryScreenOdds: async filters => {
          screenCalls.push(filters);
          return {
            game_data: [{
              gameId: 'tennis-game-1',
              league: 'Tennis',
              market: 'Moneyline',
              updatedAt: new Date(Date.now() - 20 * 1000).toISOString(),
              homeTeam: 'Player A',
              awayTeam: 'Player B',
              selections: {
                a: {
                  selection1: 'Player A',
                  participant1: 'Player A',
                  selection1Id: 'Moneyline:Player_A',
                  selection2: 'Player B',
                  participant2: 'Player B',
                  selection2Id: 'Moneyline:Player_B',
                  odds: {
                    Fliff: { odds1: 120, odds2: -130 },
                    NoVigApp: { odds1: 118, odds2: -128 },
                    Polymarket: { odds1: 110, odds2: -120 },
                    Kalshi: { odds1: 108, odds2: -122 },
                    BetOnline: { odds1: 115, odds2: -125 },
                    Circa: { odds1: 112, odds2: -123 }
                  }
                }
              },
              defaultKey: 'a'
            }]
          };
        },
        queryOddsHistory: async ({ gameId, selectionId }) => {
          historyCalls.push({ gameId, selectionId });
          return {
            Fliff: String(selectionId).includes('Player_A')
              ? [{ odds: 130, start_ts: 1 }, { odds: 120, start_ts: 2 }]
              : [{ odds: -118, start_ts: 1 }, { odds: -130, start_ts: 2 }],
            NoVigApp: [{ odds: 118, start_ts: 3 }],
            Polymarket: [{ odds: 110, start_ts: 4 }],
            meta: { gameId }
          };
        }
      }
    });

    const result = await handlers.query_tennis_screen({ market: 'Moneyline', book: 'Fliff', limit: 5, lookbackHours: 4 });
    const tennisRow = result.result.find(row => row.selectionId === 'Moneyline:Player_A' || row.normalizedSelectionId === 'Moneyline:Player_A');
    assert.ok(tennisRow);
    assert.equal(tennisRow.book, 'Fliff');
    assert.equal(tennisRow.lineHistoryAvailable, true);
    assert.equal(tennisRow.lineHistorySource, 'odds_history');
    assert.equal(tennisRow.historyGameId, 'tennis-game-1');
    assert.equal(tennisRow.normalizedSelectionId, 'Moneyline:Player_A');
    assert.equal(tennisRow.historyMatchKey, 'selectionId');
    assert.equal(tennisRow.lineHistoryLookbackHours, 4);
    assert.equal(tennisRow.tennisMarket, 'moneyline');
    assert.equal(historyCalls.length >= 1, true);
    assert.equal(screenCalls[0].league, 'Tennis');
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

  it('retries once after a 401 by refreshing the access token', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    let fetchAttempts = 0;
    const tokenCalls = [];
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async options => {
        tokenCalls.push(options);
        return {
          body: JSON.stringify({ token: tokenCalls.length === 1 ? 'jwt-1' : 'jwt-2', exp: Math.floor(Date.now() / 1000) + 600 }),
          statusCode: 200
        };
      },
      fetchImpl: async () => {
        fetchAttempts += 1;
        if (fetchAttempts === 1) {
          return { ok: false, status: 401, text: async () => 'unauthorized' };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
      retryDelaysMs: [0, 0]
    });

    try {
      const result = await client.queryScreenOdds({});
      assert.deepEqual(result, { ok: true });
      assert.equal(fetchAttempts, 2);
      assert.equal(tokenCalls.length, 2);
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

  it('tags 401 screen failures as auth errors with status metadata', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
      retryDelaysMs: [0]
    });

    try {
      await assert.rejects(() => client.queryScreenOdds({}), error => {
        assert.equal(error.category, 'auth');
        assert.equal(error.code, 'PROPPROFESSOR_AUTH_ERROR');
        assert.equal(error.status, 401);
        assert.equal(error.retryable, true);
        assert.match(error.message, /401/);
        return true;
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tags HTML checkpoint responses as transport errors', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => '<html><title>Just a moment...</title></html>' }),
      retryDelaysMs: [0]
    });

    try {
      await assert.rejects(() => client.queryScreenOdds({}), error => {
        assert.equal(error.category, 'transport');
        assert.equal(error.code, 'PROPPROFESSOR_TRANSPORT_ERROR');
        assert.equal(error.status, 429);
        assert.equal(error.retryable, true);
        assert.match(error.message, /checkpoint|429|Just a moment/i);
        return true;
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tags 5xx TRPC failures as backend errors with status metadata', async () => {
    const { dir, file } = makeTempAuthState({
      cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'cookie-value' }],
      origins: []
    });
    const client = createPropProfessorClient({
      authFile: file,
      gotScrapingImpl: async () => ({ body: JSON.stringify({ token: 'jwt', exp: Math.floor(Date.now() / 1000) + 600 }), statusCode: 200 }),
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'service unavailable' }),
      retryDelaysMs: [0]
    });

    try {
      await assert.rejects(() => client.getHiddenBets(), error => {
        assert.equal(error.category, 'backend');
        assert.equal(error.code, 'PROPPROFESSOR_BACKEND_ERROR');
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        assert.match(error.message, /503|service unavailable/i);
        return true;
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
