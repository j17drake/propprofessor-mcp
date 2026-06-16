'use strict';

const { LruCache } = require('./propprofessor-lru-cache');

const DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS = 6;
const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute
const DEFAULT_CACHE_MAX_ENTRIES = 50;

/**
 * Returns the local timezone to use for date/time display.
 * Reads from the LOCAL_TIMEZONE environment variable, defaulting to
 * America/Chicago.
 * @returns {string} IANA timezone identifier (e.g. 'America/Chicago').
 */
function getLocalTimezone() {
  return process.env.LOCAL_TIMEZONE || 'America/Chicago';
}

/**
 * Returns the number of hours to look back when fetching odds history.
 * Reads from the PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS environment variable
 * (or the optional `value` parameter), defaulting to 6.
 * @param {string|number} [value] - Override value (takes precedence over env var).
 * @returns {number} Positive number of hours.
 */
function getOddsHistoryLookbackHours(value = process.env.PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS;
}

/**
 * Returns the cache TTL in milliseconds.
 * Reads from the PROPPROFESSOR_CACHE_TTL_MS environment variable,
 * defaulting to 60 000 (1 minute).
 * @returns {number} Positive cache TTL in milliseconds.
 */
function getCacheTtlMs() {
  const parsed = Number(process.env.PROPPROFESSOR_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

/**
 * Returns the maximum number of entries in the LRU cache.
 * Reads from the PROPPROFESSOR_CACHE_MAX environment variable,
 * defaulting to 50.
 * @returns {number} Positive maximum cache entries.
 */
function getCacheMaxEntries() {
  const parsed = Number(process.env.PROPPROFESSOR_CACHE_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_MAX_ENTRIES;
}

/**
 * Build a shared response cache for MCP handlers. Wraps the canonical LruCache
 * with the runtime-config defaults (TTL and max entries). Kept as a factory
 * function (not a singleton) so tests can construct isolated caches.
 *
 * @returns {LruCache} A fresh LruCache instance with the configured defaults.
 */
function getRuntimeCache() {
  return new LruCache(getCacheMaxEntries());
}

module.exports = {
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_MAX_ENTRIES,
  getLocalTimezone,
  getOddsHistoryLookbackHours,
  getCacheTtlMs,
  getCacheMaxEntries,
  getRuntimeCache
};
