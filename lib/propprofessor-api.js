'use strict';

const fs = require('fs');
const path = require('path');
const superjson = require('superjson');

const DEFAULT_AUTH_FILE = process.env.AUTH_FILE || path.resolve(__dirname, '..', 'auth.json');
const ACCESS_TOKEN_URL = 'https://app.propprofessor.com/api/access-token';
const BACKEND_SPORTSBOOK_URL = 'https://backend.propprofessor.com/sportsbook';
const BACKEND_SMART_URL = 'https://backend.propprofessor.com/smart';
const BACKEND_FANTASY_URL = 'https://backend.propprofessor.com/fantasy';
const TRPC_BASE_URL = 'https://app.propprofessor.com/api/trpc';
const SCREEN_BASE_URL = 'https://screen.propprofessor.com';
const SLIPGEN_URL = 'https://slipgen.propprofessor.com/fantasy-picks';
const TOKEN_REFRESH_SAFETY_MS = 30 * 1000;
const DEFAULT_RETRY_DELAYS_MS = [400, 1200, 2800];

function readAuthState(authFile = DEFAULT_AUTH_FILE) {
  return JSON.parse(fs.readFileSync(authFile, 'utf8'));
}

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^\.+/, '');
}

function isPropProfessorDomain(domain) {
  const normalized = normalizeDomain(domain);
  return normalized === 'propprofessor.com' || normalized.endsWith('.propprofessor.com');
}

function buildPropProfessorCookieHeader(authState) {
  const cookies = Array.isArray(authState?.cookies) ? authState.cookies : [];
  return cookies
    .filter(cookie => cookie && isPropProfessorDomain(cookie.domain))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function defaultGotScraping(options) {
  const mod = await import('got-scraping');
  const gotScraping = mod.gotScraping || mod.default || mod;
  return gotScraping(options);
}

function serializeTrpcInput(input) {
  const serialized = superjson.serialize(input);
  const body = { '0': { json: serialized.json } };
  if (serialized.meta && Object.keys(serialized.meta).length > 0) {
    body['0'].meta = serialized.meta;
  }
  return body;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAccessToken({
  authFile = DEFAULT_AUTH_FILE,
  gotScrapingImpl = defaultGotScraping,
  now = Date.now
} = {}) {
  const authState = readAuthState(authFile);
  const cookieHeader = buildPropProfessorCookieHeader(authState);
  if (!cookieHeader) {
    throw new Error('No PropProfessor cookies found in auth.json');
  }

  const response = await gotScrapingImpl({
    url: ACCESS_TOKEN_URL,
    headers: {
      Cookie: cookieHeader,
      Referer: 'https://app.propprofessor.com/'
    },
    timeout: { request: 15000 },
    throwHttpErrors: false
  });

  const statusCode = Number(response?.statusCode || 0);
  const body = String(response?.body || '');
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Unexpected access-token response: ${body.slice(0, 200)}`);
  }

  if (statusCode !== 200 || !data || !data.token) {
    const message = data?.error || data?.message || `HTTP ${statusCode}`;
    throw new Error(`Failed to fetch PropProfessor access token: ${message}`);
  }

  return {
    token: data.token,
    exp: data.exp || Math.floor(now() / 1000) + 600,
    perm: data.perm || {}
  };
}

function createPropProfessorClient({
  authFile = DEFAULT_AUTH_FILE,
  gotScrapingImpl = defaultGotScraping,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  tokenSafetyMs = TOKEN_REFRESH_SAFETY_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }

  let cachedToken = null;

  async function getAccessToken() {
    const nowMs = now();
    if (cachedToken && cachedToken.exp && nowMs < (cachedToken.exp * 1000) - tokenSafetyMs) {
      return cachedToken;
    }
    cachedToken = await fetchAccessToken({ authFile, gotScrapingImpl, now });
    return cachedToken;
  }

  async function requestJSON(url, body, { method = 'POST', headers = {}, retryDelays = [] } = {}) {
    let lastError = null;
    const attempts = [0, ...retryDelays];
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(attempts[attempt]);
      }
      try {
        const { token } = await getAccessToken();
        const response = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Origin: 'https://app.propprofessor.com',
            Referer: 'https://app.propprofessor.com/',
            ...headers
          },
          body: body == null ? undefined : JSON.stringify(body)
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const status = Number(response.status || 0);
          const retryable = status === 429 || status >= 500;
          lastError = new Error(`PropProfessor request failed (${status}): ${text.slice(0, 200)}`);
          lastError.status = status;
          lastError.retryable = retryable;
          if (!retryable || attempt === attempts.length - 1) {
            throw lastError;
          }
          continue;
        }

        return response.json ? response.json() : JSON.parse(await response.text());
      } catch (error) {
        lastError = error;
        if (error && error.retryable === false) {
          throw error;
        }
        if (attempt === attempts.length - 1) {
          throw lastError;
        }
      }
    }
    throw lastError || new Error('PropProfessor request failed');
  }

  async function getTrpcJSON(path, input) {
    const { token } = await getAccessToken();
    const url = `${TRPC_BASE_URL}/${path}?batch=1&input=${encodeURIComponent(JSON.stringify(serializeTrpcInput(input)))}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Referer: 'https://app.propprofessor.com/fantasy'
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const status = Number(response.status || 0);
      const retryable = status === 429 || status >= 500;
      if (retryable) {
        throw new Error(`PropProfessor TRPC request failed (${status}): ${text.slice(0, 200)}`);
      }
      throw new Error(`PropProfessor TRPC request failed (${status}): ${text.slice(0, 200)}`);
    }

    return response.json ? response.json() : JSON.parse(await response.text());
  }

  return {
    getAccessToken,
    querySportsbook(filters = {}) {
      return requestJSON(BACKEND_SPORTSBOOK_URL, {
        isLive: false,
        showBreakOnly: false,
        showTimeoutOnly: false,
        showPeriodEndOnly: false,
        timeAvailable: 0,
        userState: 'tx',
        hideNCAAPlayerProps: false,
        sportsbooks: ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'Pinnacle'],
        leagues: ['NBA', 'MLB', 'NHL', 'NFL', 'NCAAB', 'NCAAF', 'WNBA'],
        minOdds: -200,
        maxOdds: 500,
        minValue: 2,
        maxValue: 999,
        marketTypes: ['Main Lines', 'Player Props'],
        periodTypes: ['Full Game'],
        minHoursAway: 0,
        maxHoursAway: 24,
        minLiquidity: 0,
        maxLiquidity: 999999,
        weightSettings: {},
        ...filters
      }, { retryDelays: retryDelaysMs });
    },
    querySmartMoney(filters = {}) {
      return requestJSON(BACKEND_SMART_URL, {
        userState: 'tx',
        hideNCAAPlayerProps: false,
        sportsbooks: ['Underdog', 'PrizePicks', 'DraftKings6', 'FanDuel', 'DraftKings'],
        leagues: ['NBA', 'MLB', 'NHL'],
        minLiquidity: 0,
        marketTypes: ['Main Lines', 'Player Props', 'Team Totals', 'Game Props'],
        periodTypes: ['Full Game', 'Single Period'],
        minHoursAway: 0,
        maxHoursAway: 24,
        ...filters
      }, { retryDelays: retryDelaysMs });
    },
    queryScreenOdds(filters = {}) {
      return requestJSON(`${SCREEN_BASE_URL}/api/retrieve-data-new`, {
        market: 'Moneyline',
        league: 'NBA',
        games: [],
        participants: [],
        books: [],
        is_live: false,
        ...filters
      }, { retryDelays: retryDelaysMs });
    },
    queryFantasyPicks(filters = {}) {
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      return requestJSON(BACKEND_FANTASY_URL, {
        fantasyApps: ['PrizePicks', 'Underdog', 'Betr', 'Dabble', 'DraftKings6'],
        minOdds: -9999,
        maxOdds: 9999,
        minLegEV: -3,
        minSlipEV: 0,
        minHoursAway: 0,
        maxHoursAway: 168,
        leagues: ['NBA', 'MLB', 'NHL', 'NFL', 'NCAAB', 'NCAAF', 'WNBA'],
        hiddenBets: [],
        liveStatus: 'prematch',
        ...normalizedFilters
      }, { retryDelays: retryDelaysMs });
    },
    queryFantasyPicksSorted(filters = {}) {
      return this.queryFantasyPicks(filters).then(rows => {
        if (!Array.isArray(rows)) return rows;
        return [...rows].sort((a, b) => Number(b?.value ?? 0) - Number(a?.value ?? 0));
      });
    },
    queryScreenOddsBestComps(filters = {}) {
      const merged = {
        books: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
        ...filters
      };
      return requestJSON(`${SCREEN_BASE_URL}/api/retrieve-data-new`, {
        market: 'Moneyline',
        league: 'NBA',
        games: [],
        participants: [],
        books: [],
        is_live: false,
        ...merged
      }, { retryDelays: retryDelaysMs });
    },
    async healthStatus() {
      const token = await getAccessToken();
      const [screenResult, fantasyResult] = await Promise.allSettled([
        this.queryScreenOdds({}),
        this.queryFantasyPicks({})
      ]);
      const screenValue = screenResult.status === 'fulfilled' ? screenResult.value : null;
      const fantasyValue = fantasyResult.status === 'fulfilled' ? fantasyResult.value : null;
      const buildFreshness = rows => {
        const timestamps = (Array.isArray(rows) ? rows : []).map(row => {
          const candidates = [row?.updatedAt, row?.lastUpdated, row?.lastUpdate, row?.timestamp, row?.time, row?.createdAt, row?.pulledAt, row?.refreshedAt, row?.asOf, row?.scrapedAt, row?.fetchedAt, row?.snapshotAt];
          for (const candidate of candidates) {
            if (!candidate) continue;
            const ms = typeof candidate === 'number' ? (candidate > 1e12 ? candidate : candidate * 1000) : Date.parse(candidate);
            if (Number.isFinite(ms)) return ms;
          }
          return null;
        }).filter(ms => Number.isFinite(ms));
        if (!timestamps.length) return { rowCount: Array.isArray(rows) ? rows.length : 0, newestAgeMs: null, oldestAgeMs: null, stale: false };
        const ages = timestamps.map(ms => Math.max(0, Date.now() - ms));
        return { rowCount: Array.isArray(rows) ? rows.length : 0, newestAgeMs: Math.min(...ages), oldestAgeMs: Math.max(...ages), stale: false };
      };
      const screenRows = Array.isArray(screenValue) ? screenValue : Array.isArray(screenValue?.game_data) ? screenValue.game_data : Array.isArray(screenValue?.data) ? screenValue.data : [];
      const fantasyRows = Array.isArray(fantasyValue) ? fantasyValue : [];
      return {
        ok: true,
        token: {
          exp: token.exp,
          expiresInSeconds: Math.max(0, Math.floor(token.exp - (now() / 1000)))
        },
        endpoints: {
          screen: screenResult.status === 'fulfilled' ? 'ok' : 'error',
          fantasy: fantasyResult.status === 'fulfilled' ? 'ok' : 'error'
        },
        freshness: {
          screen: buildFreshness(screenRows),
          fantasy: buildFreshness(fantasyRows)
        }
      };
    },
    getHiddenBets() {
      return getTrpcJSON('hidden.getHiddenBets', null);
    },
    hideBet(bet) {
      return getTrpcJSON('hidden.hideBet', bet);
    },
    unhideBet(id) {
      return getTrpcJSON('hidden.unhideBet', { id });
    },
    clearHiddenBets() {
      return getTrpcJSON('hidden.clearHiddenBets', null);
    }
  };
}

module.exports = {
  ACCESS_TOKEN_URL,
  BACKEND_SMART_URL,
  BACKEND_SPORTSBOOK_URL,
  DEFAULT_AUTH_FILE,
  SCREEN_BASE_URL,
  SLIPGEN_URL,
  buildPropProfessorCookieHeader,
  createPropProfessorClient,
  fetchAccessToken,
  readAuthState
};
