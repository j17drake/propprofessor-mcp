'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_AUTH_FILE = path.resolve(__dirname, '..', 'auth.json');
const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.propprofessor');
const DEFAULT_USER_AUTH_FILE = path.join(DEFAULT_AUTH_DIR, 'auth.json');
const ACCESS_TOKEN_URL = 'https://app.propprofessor.com/api/access-token';
const TOKEN_CACHE_SAFETY_MS = 5 * 60 * 1000; // Refresh if within 5 min of expiry

// ===== Token persistence =====
function getTokenCacheFile(authFile) {
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
    // 0o600 — owner read/write only. The token cache holds a bearer token
    // (June 8 SEC-003): readable files on a multi-user box leak session.
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
      { mode: 0o600, encoding: 'utf8' }
    );
    // mkdirSync above can create the dir with 0o755 default; on platforms
    // that ignore the writeFileSync mode arg (e.g. when the file pre-exists
    // from a prior install), explicitly chmod to lock it down. Idempotent.
    try {
      fs.chmodSync(cacheFile, 0o600);
    } catch {
      // Best effort — chmod failures on read-only volumes are non-fatal
    }
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

// ===== Auth file resolution =====
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
  // copyFileSync inherits the source file's mode (typically 0o600 since browsers
  // and Playwright write private storage state), but auth.json may have been
  // pre-existing at 0o644 from a prior install. Force 0o600 to lock it down
  // (June 8 SEC-003). Best-effort — chmod failures on read-only volumes are
  // non-fatal for the install itself.
  try {
    fs.chmodSync(resolvedDestination, 0o600);
  } catch {
    // Best effort
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

// ===== Cookie / domain helpers =====
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
      return {
        status: 'browser_session_only',
        sessionExpiry: null,
        daysRemaining: null,
        warning: 'Session cookies are browser-only (no expiry set). Re-login when browser closes.'
      };
    }
    return {
      status: 'no_session_token',
      sessionExpiry: null,
      daysRemaining: null,
      warning: 'No session token found in auth file'
    };
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
      daysRemaining: Math.round(((c.expires * 1000 - nowMs) / (1000 * 60 * 60 * 24)) * 10) / 10
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

// ===== Token fetch =====
async function defaultGotScraping(options) {
  const mod = await import('got-scraping');
  const gotScraping = mod.gotScraping || mod.default || mod;
  return gotScraping(options);
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

module.exports = {
  ACCESS_TOKEN_URL,
  DEFAULT_AUTH_DIR,
  DEFAULT_AUTH_FILE,
  DEFAULT_USER_AUTH_FILE,
  REPO_AUTH_FILE,
  TOKEN_CACHE_SAFETY_MS,
  // Token persistence
  getTokenCacheFile,
  readTokenCache,
  writeTokenCache,
  isTokenCacheValid,
  clearTokenCache,
  // Auth file resolution
  getExplicitAuthFile,
  uniqueAuthPaths,
  getAuthFileCandidates,
  ensureAuthParentDirectory,
  installAuthFile,
  resolveAuthFile,
  readAuthState,
  inspectAuthSetup,
  // Cookie / domain helpers
  normalizeDomain,
  isPropProfessorDomain,
  isAuthValid,
  getCookieExpiryInfo,
  buildPropProfessorCookieHeader,
  // Token fetch
  fetchAccessToken
};
