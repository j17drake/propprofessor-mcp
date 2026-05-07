'use strict';

const fs = require('fs');
const path = require('path');
const superjson = require('superjson');

const { getSharpBookComparisonSet } = require('./propprofessor-sharp-books');
const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');
const { summarizeFreshness } = require('./propprofessor-screen-utils');

const DEFAULT_AUTH_FILE = process.env.AUTH_FILE || path.resolve(__dirname, '..', 'auth.json');
const ACCESS_TOKEN_URL = 'https://app.propprofessor.com/api/access-token';
const BACKEND_SPORTSBOOK_URL = 'https://backend.propprofessor.com/sportsbook';
const BACKEND_SMART_URL = 'https://backend.propprofessor.com/smart';
const BACKEND_ODDS_HISTORY_URL = 'https://backend.propprofessor.com/odds_history_new';
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

function normalizeSelectionId(selectionId) {
  const raw = String(selectionId || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length > 2) return parts.slice(1).join(':');
  return raw;
}

function normalizeScreenLeagueName(league) {
  const raw = String(league || '').trim();
  if (!raw) return raw;
  const upper = raw.toUpperCase();
  const canonical = {
    NBA: 'NBA',
    MLB: 'MLB',
    NFL: 'NFL',
    NHL: 'NHL',
    WNBA: 'WNBA',
    NCAAB: 'NCAAB',
    NCAAF: 'NCAAF',
    SOCCER: 'Soccer',
    'FOOTBALL/SOCCER': 'Soccer',
    FUTBOL: 'Soccer',
    TENNIS: 'Tennis'
  };
  return canonical[upper] || raw;
}

function getOddsHistoryStartTimestamp({ lookbackHours = getOddsHistoryLookbackHours(), nowMs = Date.now() } = {}) {
  const safeHours = getOddsHistoryLookbackHours(lookbackHours);
  const now = Number(nowMs);
  const safeNowMs = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, Math.floor(safeNowMs / 1000) - Math.floor(safeHours * 60 * 60));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createTaggedError({ message, code, category, status, retryable, details } = {}) {
  const error = new Error(message || 'PropProfessor request failed');
  if (code) error.code = code;
  if (category) error.category = category;
  if (status !== undefined) error.status = status;
  if (retryable !== undefined) error.retryable = retryable;
  if (details !== undefined) error.details = details;
  return error;
}

function classifyPropProfessorHttpError({ status, text, source }) {
  const normalizedText = String(text || '').slice(0, 200);
  const lowerText = normalizedText.toLowerCase();
  const isHtmlCheckpoint = lowerText.includes('<html') || lowerText.includes('<!doctype') || lowerText.includes('just a moment') || lowerText.includes('cf-chl') || lowerText.includes('captcha');

  if (status === 401) {
    return createTaggedError({
      message: `PropProfessor ${source} auth failed (${status}): ${normalizedText}`,
      code: 'PROPPROFESSOR_AUTH_ERROR',
      category: 'auth',
      status,
      retryable: true
    });
  }

  if (status === 429 && isHtmlCheckpoint) {
    return createTaggedError({
      message: `PropProfessor ${source} transport checkpoint (${status}): ${normalizedText}`,
      code: 'PROPPROFESSOR_TRANSPORT_ERROR',
      category: 'transport',
      status,
      retryable: true
    });
  }

  if (status === 429 || status >= 500) {
    return createTaggedError({
      message: `PropProfessor ${source} backend failed (${status}): ${normalizedText}`,
      code: 'PROPPROFESSOR_BACKEND_ERROR',
      category: 'backend',
      status,
      retryable: true
    });
  }

  return createTaggedError({
    message: `PropProfessor ${source} request failed (${status}): ${normalizedText}`,
    code: 'PROPPROFESSOR_REQUEST_ERROR',
    category: 'validation',
    status,
    retryable: false
  });
}

async function fetchAccessToken({
  authFile = DEFAULT_AUTH_FILE,
  gotScrapingImpl = defaultGotScraping,
  now = Date.now
} = {}) {
  const authState = readAuthState(authFile);
  const cookieHeader = buildPropProfessorCookieHeader(authState);
  if (!cookieHeader) {
    throw new Error(`No PropProfessor cookies found in ${authFile}`);
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

  function invalidateAccessToken() {
    cachedToken = null;
  }

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
          const retryable = status === 429 || status >= 500 || status === 401;
          lastError = classifyPropProfessorHttpError({ status, text, source: 'HTTP' });
          if (status === 401) {
            invalidateAccessToken();
          }
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
    const delays = [0, ...retryDelaysMs];
    const url = `${TRPC_BASE_URL}/${path}?batch=1&input=${encodeURIComponent(JSON.stringify(serializeTrpcInput(input)))}`;
    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(delays[attempt]);
      }
      const { token } = await getAccessToken();
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
        const retryable = status === 429 || status >= 500 || status === 401;
        lastError = classifyPropProfessorHttpError({ status, text, source: 'TRPC' });
        if (status === 401) {
          invalidateAccessToken();
        }
        if (!retryable || attempt === delays.length - 1) {
          throw lastError;
        }
        continue;
      }

      return response.json ? response.json() : JSON.parse(await response.text());
    }

    throw lastError || new Error('PropProfessor TRPC request failed');
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
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      return requestJSON(`${SCREEN_BASE_URL}/api/retrieve-data-new`, {
        market: 'Moneyline',
        league: 'NBA',
        games: [],
        participants: [],
        books: [],
        is_live: false,
        ...normalizedFilters,
        league: normalizeScreenLeagueName(normalizedFilters.league ?? 'NBA')
      }, { retryDelays: retryDelaysMs });
    },
    queryScreenOddsBestComps(filters = {}) {
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      const merged = {
        ...normalizedFilters,
        books: normalizedFilters.books === undefined
          ? getSharpBookComparisonSet({ league: normalizedFilters.league ?? 'NBA', market: normalizedFilters.market })
          : normalizedFilters.books
      };
      return requestJSON(`${SCREEN_BASE_URL}/api/retrieve-data-new`, {
        market: 'Moneyline',
        league: 'NBA',
        games: [],
        participants: [],
        books: [],
        is_live: false,
        ...merged,
        league: normalizeScreenLeagueName(merged.league ?? 'NBA')
      }, { retryDelays: retryDelaysMs });
    },
    queryOddsHistory({ gameId, selectionId, startTimestamp, sportsbooks = [], lookbackHours = getOddsHistoryLookbackHours(), nowMs = now() } = {}) {
      if (!gameId) {
        throw new Error('gameId is required');
      }
      const normalizedSelectionId = normalizeSelectionId(selectionId);
      if (!normalizedSelectionId) {
        throw new Error('selectionId is required');
      }
      const resolvedStartTimestamp = Number.isFinite(Number(startTimestamp))
        ? Number(startTimestamp)
        : getOddsHistoryStartTimestamp({ lookbackHours, nowMs });
      return requestJSON(BACKEND_ODDS_HISTORY_URL, {
        gameId,
        selectionId: normalizedSelectionId,
        sportsbooks: Array.isArray(sportsbooks) ? sportsbooks : [],
        startTimestamp: resolvedStartTimestamp
      }, { retryDelays: retryDelaysMs });
    },
    async healthStatus() {
      const token = await getAccessToken();
      const [screenResult] = await Promise.allSettled([
        this.queryScreenOdds({})
      ]);
      const screenValue = screenResult.status === 'fulfilled' ? screenResult.value : null;
      const screenRows = Array.isArray(screenValue)
        ? screenValue
        : Array.isArray(screenValue?.game_data)
          ? screenValue.game_data
          : Array.isArray(screenValue?.data)
            ? screenValue.data
            : [];
      const endpoints = {
        screen: screenResult.status === 'fulfilled' ? 'ok' : 'error'
      };
      const ok = endpoints.screen === 'ok';
      return {
        ok,
        token: {
          exp: token.exp,
          expiresInSeconds: Math.max(0, Math.floor(token.exp - (now() / 1000)))
        },
        endpoints,
        freshness: {
          screen: summarizeFreshness(screenRows, now())
        },
        errors: {
          screen: screenResult.status === 'rejected' ? (screenResult.reason?.message || String(screenResult.reason)) : null
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
  getOddsHistoryStartTimestamp,
  normalizeSelectionId,
  readAuthState
};
