'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getSharpBookComparisonSet, ALL_SCREEN_BOOKS, uniqueBooks } = require('./propprofessor-sharp-books');
const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');
const { summarizeFreshness } = require('./propprofessor-screen-utils');
const { getOddsHistoryStartTimestamp } = require('./propprofessor-shared-utils');

const REPO_AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.propprofessor');
const DEFAULT_USER_AUTH_FILE = path.join(DEFAULT_AUTH_DIR, 'auth.json');
const ACCESS_TOKEN_URL = 'https://app.propprofessor.com/api/access-token';
const BACKEND_SPORTSBOOK_URL = 'https://backend.propprofessor.com/sportsbook';
const BACKEND_SMART_URL = 'https://backend.propprofessor.com/smart';
const BACKEND_ODDS_HISTORY_URL = 'https://backend.propprofessor.com/odds_history_new';
const TRPC_BASE_URL = 'https://app.propprofessor.com/api/trpc';
const SCREEN_BASE_URL = 'https://backend.propprofessor.com';
const SLIPGEN_URL = 'https://slipgen.propprofessor.com/fantasy-picks';

// Full books list is now defined in propprofessor-sharp-books.js and imported above.
const TOKEN_REFRESH_SAFETY_MS = 30 * 1000;
const DEFAULT_RETRY_DELAYS_MS = [400, 1200, 2800];
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const TOKEN_CACHE_SAFETY_MS = 5 * 60 * 1000; // Refresh if within 5 min of expiry
let superjsonPromise = null;

// ===== Token persistence =====
function getTokenCacheFile(authFile) {
  // Derive cache path from auth file location
  const authDir = path.dirname(authFile);
  return path.join(authDir, 'token-cache.json');
}

function readTokenCache(authFile) {
  try {
    const cacheFile = getTokenCacheFile(authFile);
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.token && data.exp && typeof data.exp === 'number') {
      return data;
    }
  } catch {
    // File missing or corrupt — that's fine
  }
  return null;
}

function writeTokenCache(tokenData, authFile) {
  try {
    const cacheFile = getTokenCacheFile(authFile);
    const dir = path.dirname(cacheFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify(
        {
          token: tokenData.token,
          exp: tokenData.exp,
          perm: tokenData.perm || {},
          cachedAt: Date.now()
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // Best effort — don't break auth if cache write fails
  }
}

function isTokenCacheValid(cached, safetyMs = TOKEN_CACHE_SAFETY_MS) {
  if (!cached || !cached.exp) return false;
  const nowMs = Date.now();
  return nowMs < cached.exp * 1000 - safetyMs;
}

function clearTokenCache(authFile) {
  try {
    const cacheFile = getTokenCacheFile(authFile);
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  } catch {
    // Best effort
  }
}

function getExplicitAuthFile() {
  const raw = String(process.env.AUTH_FILE || '').trim();
  return raw || null;
}

function uniqueAuthPaths(paths) {
  const seen = new Set();
  return paths.filter((file) => {
    const normalized = String(file || '').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Get the list of candidate auth file paths to check, in priority order.
 * @returns {string[]} Array of auth file paths (explicit env var, user default, repo default).
 */
function getAuthFileCandidates() {
  return uniqueAuthPaths([getExplicitAuthFile(), DEFAULT_USER_AUTH_FILE, REPO_AUTH_FILE]);
}

/**
 * Ensure the parent directory for an auth file exists, creating it if needed.
 * @param {string} [authFile] - Path to the auth file whose parent directory should exist.
 * @returns {string} The parent directory path.
 */
function ensureAuthParentDirectory(authFile = DEFAULT_USER_AUTH_FILE) {
  const directory = path.dirname(authFile);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Copy an auth file from a source path to the destination path.
 * @param {Object} [options] - Options object.
 * @param {string} options.sourceFile - Path to the source auth file (required).
 * @param {string} [options.destinationFile] - Destination path (defaults to user auth file).
 * @returns {Object} Result with ok, sourceFile, destinationFile, usedExistingFile.
 */
function installAuthFile({ sourceFile, destinationFile = DEFAULT_USER_AUTH_FILE } = {}) {
  const sourcePath = String(sourceFile || '').trim();
  const destinationPath = String(destinationFile || '').trim() || DEFAULT_USER_AUTH_FILE;
  if (!sourcePath) {
    throw new Error('sourceFile is required');
  }

  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Auth source file not found: ${resolvedSource}`);
  }

  ensureAuthParentDirectory(resolvedDestination);
  if (resolvedSource !== resolvedDestination) {
    fs.copyFileSync(resolvedSource, resolvedDestination);
  }

  return {
    ok: true,
    sourceFile: resolvedSource,
    destinationFile: resolvedDestination,
    usedExistingFile: resolvedSource === resolvedDestination
  };
}

/**
 * Resolve the auth file path to use, checking explicit env var, user default, and repo default.
 * @returns {string} The resolved auth file path.
 */
function resolveAuthFile() {
  const explicitAuthFile = getExplicitAuthFile();
  if (explicitAuthFile) {
    return explicitAuthFile;
  }

  if (fs.existsSync(DEFAULT_USER_AUTH_FILE)) {
    return DEFAULT_USER_AUTH_FILE;
  }
  if (fs.existsSync(REPO_AUTH_FILE)) {
    return REPO_AUTH_FILE;
  }
  return DEFAULT_USER_AUTH_FILE;
}

/**
 * Inspect the current auth setup, checking all candidate auth files for validity.
 * @returns {Object} Inspection result with ok, source, selectedAuthFile, and checkedPaths details.
 */
function inspectAuthSetup() {
  const selectedAuthFile = resolveAuthFile();
  const checkedPaths = getAuthFileCandidates().map((file) => {
    let exists = false;
    let readable = false;
    let parseable = false;
    let propProfessorCookieCount = 0;
    let error = null;

    try {
      exists = fs.existsSync(file);
      if (exists) {
        fs.accessSync(file, fs.constants.R_OK);
        readable = true;
        const authState = readAuthState(file);
        parseable = true;
        const cookies = Array.isArray(authState?.cookies) ? authState.cookies : [];
        propProfessorCookieCount = cookies.filter((cookie) => cookie && isPropProfessorDomain(cookie.domain)).length;
      }
    } catch (cause) {
      error = String(cause?.message || cause);
    }

    return {
      path: file,
      exists,
      readable,
      parseable,
      propProfessorCookieCount,
      selected: file === selectedAuthFile,
      error
    };
  });

  const selectedEntry = checkedPaths.find((entry) => entry.selected) || {
    path: selectedAuthFile,
    exists: false,
    readable: false,
    parseable: false,
    propProfessorCookieCount: 0,
    selected: true,
    error: null
  };

  const source = getExplicitAuthFile() ? 'AUTH_FILE' : selectedAuthFile === DEFAULT_USER_AUTH_FILE ? 'user' : 'repo';

  // Cookie expiry analysis for the selected auth file
  let sessionExpiry = null;
  if (selectedEntry.exists && selectedEntry.parseable) {
    try {
      const authState = readAuthState(selectedAuthFile);
      sessionExpiry = getCookieExpiryInfo(authState);
    } catch {
      // Best effort
    }
  }

  return {
    ok:
      selectedEntry.exists &&
      selectedEntry.readable &&
      selectedEntry.parseable &&
      selectedEntry.propProfessorCookieCount > 0,
    source,
    selectedAuthFile,
    defaultUserAuthFile: DEFAULT_USER_AUTH_FILE,
    repoAuthFile: REPO_AUTH_FILE,
    checkedPaths,
    selected: selectedEntry,
    sessionExpiry
  };
}

const DEFAULT_AUTH_FILE = resolveAuthFile();

/**
 * Read and parse the auth state from a JSON auth file.
 * @param {string} [authFile] - Path to the auth file to read (defaults to resolved auth file).
 * @returns {Object} Parsed auth state object.
 * @throws {Error} If the file is missing, unreadable, or contains invalid JSON.
 */
function readAuthState(authFile = resolveAuthFile()) {
  try {
    return JSON.parse(fs.readFileSync(authFile, 'utf8'));
  } catch (error) {
    const message =
      error?.code === 'ENOENT'
        ? `PropProfessor auth file not found: ${authFile}`
        : error?.code === 'EACCES'
          ? `PropProfessor auth file not readable: ${authFile}`
          : `Failed to read PropProfessor auth file at ${authFile}: ${error?.message || error}`;
    throw new Error(message, { cause: error });
  }
}

function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');
}

function isPropProfessorDomain(domain) {
  const normalized = normalizeDomain(domain);
  return normalized === 'propprofessor.com' || normalized.endsWith('.propprofessor.com');
}

/**
 * Check whether an auth object is valid (has at least one non-empty PropProfessor cookie).
 * @param {*} auth - The auth object to validate.
 * @returns {boolean} True if the auth object has valid PropProfessor cookies.
 */
function isAuthValid(auth) {
  if (auth == null || typeof auth !== 'object') return false;
  if (!Array.isArray(auth.cookies)) return false;
  return auth.cookies.some(
    (cookie) =>
      cookie &&
      typeof cookie === 'object' &&
      isPropProfessorDomain(cookie.domain) &&
      typeof cookie.value === 'string' &&
      cookie.value.length > 0
  );
}

/**
 * Analyze cookie expiry dates from auth state to detect upcoming session expiration.
 * Focuses on the NextAuth session token (__Secure-next-auth.session-token) which is
 * the critical cookie — when it expires, the entire session is dead regardless of other cookies.
 * @param {Object} auth - The auth state object (from readAuthState).
 * @param {Function} [nowFn] - Function returning current time in ms. Defaults to Date.now.
 * @returns {Object} Expiry analysis with sessionExpiry, daysRemaining, status, and warning.
 */
function getCookieExpiryInfo(auth, nowFn = Date.now) {
  const nowMs = nowFn();
  const nowSec = nowMs / 1000;

  if (auth == null || typeof auth !== 'object' || !Array.isArray(auth.cookies)) {
    return { status: 'no_auth', sessionExpiry: null, daysRemaining: null, warning: 'No auth file found' };
  }

  const ppCookies = auth.cookies.filter(
    (c) => c && isPropProfessorDomain(c.domain) && typeof c.expires === 'number' && c.expires > 0
  );

  // Find the NextAuth session token — this is the one that matters
  const sessionCookie = ppCookies.find((c) => c.name === '__Secure-next-auth.session-token');

  if (!sessionCookie) {
    // Check for session cookies (expires === -1 means browser-session only)
    const sessionCookies = auth.cookies.filter(
      (c) => c && isPropProfessorDomain(c.domain) && c.name && c.name.includes('session')
    );
    if (sessionCookies.length > 0 && ppCookies.length === 0) {
      return { status: 'browser_session_only', sessionExpiry: null, daysRemaining: null, warning: 'Session cookies are browser-only (no expiry set). Re-login when browser closes.' };
    }
    return { status: 'no_session_token', sessionExpiry: null, daysRemaining: null, warning: 'No session token found in auth file' };
  }

  const expirySec = sessionCookie.expires;
  const expiryMs = expirySec * 1000;
  const daysRemaining = (expiryMs - nowMs) / (1000 * 60 * 60 * 24);
  const expiryDate = new Date(expiryMs).toISOString();

  let status;
  let warning;
  if (daysRemaining <= 0) {
    status = 'expired';
    warning = `Session expired ${Math.abs(Math.round(daysRemaining))} day(s) ago. Run: pp-query login`;
  } else if (daysRemaining <= 3) {
    status = 'critical';
    warning = `Session expires in ${Math.round(daysRemaining * 10) / 10} day(s) (${expiryDate}). Run: pp-query login soon`;
  } else if (daysRemaining <= 7) {
    status = 'warning';
    warning = `Session expires in ${Math.round(daysRemaining)} day(s) (${expiryDate}). Consider re-login.`;
  } else {
    status = 'ok';
    warning = null;
  }

  return {
    status,
    sessionExpiry: expiryDate,
    sessionExpiryUnix: expirySec,
    daysRemaining: Math.round(daysRemaining * 10) / 10,
    warning,
    cookieCount: ppCookies.length,
    allCookieExpiries: ppCookies.map((c) => ({
      name: c.name,
      expires: new Date(c.expires * 1000).toISOString(),
      daysRemaining: Math.round(((c.expires * 1000) - nowMs) / (1000 * 60 * 60 * 24) * 10) / 10
    }))
  };
}

/**
 * Build a Cookie header string from auth state, filtering only PropProfessor domain cookies.
 * @param {Object} authState - The auth state object.
 * @param {Array<Object>} [authState.cookies] - Array of cookie objects with name, value, and domain.
 * @returns {string} Semicolon-separated cookie header string.
 */
function buildPropProfessorCookieHeader(authState) {
  const cookies = Array.isArray(authState?.cookies) ? authState.cookies : [];
  return cookies
    .filter((cookie) => cookie && isPropProfessorDomain(cookie.domain))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getSuperjson() {
  if (!superjsonPromise) {
    superjsonPromise = import('superjson');
  }
  const mod = await superjsonPromise;
  return mod.default || mod;
}

async function defaultGotScraping(options) {
  const mod = await import('got-scraping');
  const gotScraping = mod.gotScraping || mod.default || mod;
  return gotScraping(options);
}

async function serializeTrpcInput(input) {
  const superjson = await getSuperjson();
  const serialized = superjson.serialize(input);
  const body = { 0: { json: serialized.json } };
  if (serialized.meta && Object.keys(serialized.meta).length > 0) {
    body['0'].meta = serialized.meta;
  }
  return body;
}

/**
 * Normalize a selection ID by stripping the leading segment if colon-delimited.
 * @param {string} [selectionId] - The raw selection ID to normalize.
 * @returns {string} Normalized selection ID (empty string if input is empty).
 */
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
    TENNIS: 'Tennis',
    UFC: 'UFC',
    MMA: 'UFC'
  };
  return canonical[upper] || raw;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Check whether an error is abort-like (AbortError, timeout, or connection abort).
 * @param {*} error - The error to inspect.
 * @returns {boolean} True if the error is an abort or timeout type.
 */
function isAbortLikeError(error) {
  return Boolean(
    error &&
    (error.name === 'AbortError' ||
      error.code === 'ABORT_ERR' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'UND_ERR_ABORTED')
  );
}

/**
 * Create a tagged timeout error with PropProfessor-specific metadata.
 * @param {Object} [options] - Options object.
 * @param {string} [options.source] - Source label for the timeout (e.g. 'request', 'HTTP', 'TRPC').
 * @param {number} [options.timeoutMs] - The timeout duration in milliseconds.
 * @param {Error} [options.cause] - The underlying error that caused the timeout.
 * @returns {Error} Tagged error with code, category, retryable, and details.
 */
function createTimeoutError({ source, timeoutMs, cause } = {}) {
  return createTaggedError({
    message: `PropProfessor ${source || 'request'} timed out after ${timeoutMs}ms`,
    code: 'PROPPROFESSOR_TIMEOUT_ERROR',
    category: 'transport',
    retryable: true,
    details: {
      source: source || 'request',
      timeoutMs,
      cause: cause ? String(cause.message || cause) : undefined
    }
  });
}

async function fetchWithTimeout(
  fetchImpl,
  url,
  options,
  { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, source = 'request' } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw createTimeoutError({ source, timeoutMs, cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function classifyPropProfessorHttpError({ status, text, source }) {
  const normalizedText = String(text || '').slice(0, 200);
  const lowerText = normalizedText.toLowerCase();
  const isHtmlCheckpoint =
    lowerText.includes('<html') ||
    lowerText.includes('<!doctype') ||
    lowerText.includes('just a moment') ||
    lowerText.includes('cf-chl') ||
    lowerText.includes('captcha');

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

/**
 * Fetch a PropProfessor access token using stored auth cookies.
 * @param {Object} [options] - Options object.
 * @param {string} [options.authFile] - Path to the auth file containing cookies.
 * @param {Function} [options.gotScrapingImpl] - got-scraping implementation for HTTP requests.
 * @param {Function} [options.now] - Function returning current timestamp in milliseconds.
 * @returns {Promise<Object>} Token object with token (string), exp (number), and perm (Object).
 * @throws {Error} If no PropProfessor cookies are found or the token request fails.
 */
async function fetchAccessToken({
  authFile = resolveAuthFile(),
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

/**
 * Create a PropProfessor API client with built-in auth, retry, and timeout logic.
 * The returned client object includes methods for querying sportsbooks, screen odds,
 * fantasy picks, odds history, and hidden bet management.
 * @param {Object} [options] - Configuration options.
 * @param {string} [options.authFile] - Path to the auth file. Defaults to resolved auth file.
 * @param {Function} [options.gotScrapingImpl] - got-scraping implementation for access-token fetch.
 * @param {Function} [options.fetchImpl] - Fetch implementation for API calls. Defaults to globalThis.fetch.
 * @param {Function} [options.now] - Function returning current timestamp in milliseconds. Defaults to Date.now.
 * @param {number} [options._tokenSafetyMs] - Token refresh safety margin in ms. Defaults to 30000.
 * @param {number[]} [options.retryDelaysMs] - Retry delay array in ms. Defaults to [400, 1200, 2800].
 * @param {number} [options.requestTimeoutMs] - Request timeout in ms. Defaults to 15000.
 * @returns {Object} Client object with methods: getAccessToken, querySportsbook, querySmartMoney,
 *   queryScreenOdds, queryScreenOddsBestComps, queryFantasyPicks, queryOddsHistory,
 *   healthStatus, getHiddenBets, hideBet, unhideBet, clearHiddenBets.
 * @throws {Error} If fetchImpl is not a function.
 */
function createPropProfessorClient({
  authFile = resolveAuthFile(),
  gotScrapingImpl = defaultGotScraping,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  _tokenSafetyMs = TOKEN_REFRESH_SAFETY_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function');
  }

  let cachedToken = null;
  let tokenRefreshCount = 0;
  let lastTokenRefreshed = null;
  let tokenRefreshPromise = null; // Mutex: prevents concurrent token refreshes

  function invalidateAccessToken() {
    cachedToken = null;
    clearTokenCache(authFile);
    // Don't clear tokenRefreshPromise here — let the in-flight refresh finish
  }

  async function getAccessToken() {
    const nowMs = now();

    // 1. Check in-memory cache
    if (cachedToken && cachedToken.exp && nowMs < cachedToken.exp * 1000 - TOKEN_REFRESH_SAFETY_MS) {
      return cachedToken;
    }

    // 2. Check disk cache
    const diskCache = readTokenCache(authFile);
    if (diskCache && isTokenCacheValid(diskCache, TOKEN_REFRESH_SAFETY_MS)) {
      cachedToken = diskCache;
      return cachedToken;
    }

    // 3. If a refresh is already in flight, wait for it (mutex)
    if (tokenRefreshPromise) {
      return tokenRefreshPromise;
    }

    // 4. Start a new refresh (only one at a time)
    tokenRefreshPromise = (async () => {
      try {
        const newToken = await fetchAccessToken({ authFile, gotScrapingImpl, now });
        cachedToken = newToken;
        tokenRefreshCount += 1;
        lastTokenRefreshed = new Date().toISOString();
        writeTokenCache(cachedToken, authFile);
        return cachedToken;
      } finally {
        tokenRefreshPromise = null;
      }
    })();

    return tokenRefreshPromise;
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
        const response = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Origin: 'https://app.propprofessor.com',
              Referer: 'https://app.propprofessor.com/',
              ...headers
            },
            body: body == null ? undefined : JSON.stringify(body)
          },
          { timeoutMs: requestTimeoutMs, source: 'HTTP' }
        );

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
    const serializedInput = await serializeTrpcInput(input);
    const url = `${TRPC_BASE_URL}/${path}?batch=1&input=${encodeURIComponent(JSON.stringify(serializedInput))}`;
    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(delays[attempt]);
      }
      const { token } = await getAccessToken();
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Referer: 'https://app.propprofessor.com/fantasy'
          }
        },
        { timeoutMs: requestTimeoutMs, source: 'TRPC' }
      );

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
      return requestJSON(
        BACKEND_SPORTSBOOK_URL,
        {
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
        },
        { retryDelays: retryDelaysMs }
      );
    },
    querySmartMoney(filters = {}) {
      return requestJSON(
        BACKEND_SMART_URL,
        {
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
        },
        { retryDelays: retryDelaysMs }
      );
    },
    queryScreenOdds(filters = {}) {
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      const normalizedBooks = uniqueBooks(normalizedFilters.books);
      const books =
        normalizedFilters.books !== undefined && normalizedBooks.length ? normalizedBooks : ALL_SCREEN_BOOKS;
      return requestJSON(
        `${SCREEN_BASE_URL}/screen`,
        {
          market: 'Moneyline',
          games: [],
          participants: [],
          is_live: false,
          ...normalizedFilters,
          books,
          league: normalizeScreenLeagueName(normalizedFilters.league ?? 'NBA')
        },
        { retryDelays: retryDelaysMs }
      );
    },
    queryScreenOddsBestComps(filters = {}) {
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      const hasExplicitBooks = normalizedFilters.books !== undefined;
      const normalizedBooks = uniqueBooks(normalizedFilters.books);
      const merged = {
        ...normalizedFilters,
        books: hasExplicitBooks
          ? normalizedBooks
          : getSharpBookComparisonSet({ league: normalizedFilters.league ?? 'NBA', market: normalizedFilters.market })
      };
      // For non-major leagues, fall back to full books list since the backend
      // only returns multi-book data when the complete list is passed.
      if (!hasExplicitBooks) {
        const league = (normalizedFilters.league ?? 'NBA').toUpperCase();
        if (!['NBA', 'NFL', 'MLB'].includes(league)) {
          merged.books = ALL_SCREEN_BOOKS;
        }
      }
      return requestJSON(
        `${SCREEN_BASE_URL}/screen`,
        {
          market: 'Moneyline',
          games: [],
          participants: [],
          books: [],
          is_live: false,
          ...merged,
          league: normalizeScreenLeagueName(merged.league ?? 'NBA')
        },
        { retryDelays: retryDelaysMs }
      );
    },
    queryFantasyPicks(filters = {}) {
      const normalizedFilters = filters && typeof filters === 'object' ? filters : {};
      return requestJSON(
        SLIPGEN_URL,
        {
          ...normalizedFilters
        },
        {
          retryDelays: retryDelaysMs,
          headers: {
            Referer: 'https://app.propprofessor.com/fantasy'
          }
        }
      );
    },
    queryOddsHistory({
      gameId,
      selectionId,
      startTimestamp,
      sportsbooks = [],
      lookbackHours = getOddsHistoryLookbackHours(),
      nowMs = now()
    } = {}) {
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
      return requestJSON(
        BACKEND_ODDS_HISTORY_URL,
        {
          gameId,
          selectionId: normalizedSelectionId,
          sportsbooks: Array.isArray(sportsbooks) ? sportsbooks : [],
          startTimestamp: resolvedStartTimestamp
        },
        { retryDelays: retryDelaysMs }
      );
    },
    async healthStatus() {
      const token = await getAccessToken();
      const [screenResult] = await Promise.allSettled([this.queryScreenOdds({})]);
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
      const diskCache = readTokenCache(authFile);
      return {
        ok,
        token: {
          exp: token.exp,
          expiresInSeconds: Math.max(0, Math.floor(token.exp - now() / 1000)),
          persistedToDisk: Boolean(diskCache),
          refreshCount: tokenRefreshCount,
          lastRefreshed: lastTokenRefreshed
        },
        endpoints,
        freshness: {
          screen: summarizeFreshness(screenRows, now())
        },
        errors: {
          screen:
            screenResult.status === 'rejected' ? screenResult.reason?.message || String(screenResult.reason) : null
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
  DEFAULT_USER_AUTH_FILE,
  SCREEN_BASE_URL,
  SLIPGEN_URL,
  buildPropProfessorCookieHeader,
  classifyPropProfessorHttpError,
  createPropProfessorClient,
  createTimeoutError,
  ensureAuthParentDirectory,
  fetchAccessToken,
  getAuthFileCandidates,
  getCookieExpiryInfo,
  getOddsHistoryStartTimestamp,
  installAuthFile,
  inspectAuthSetup,
  isAbortLikeError,
  isAuthValid,
  normalizeSelectionId,
  resolveAuthFile,
  REPO_AUTH_FILE,
  readAuthState
};
