'use strict';

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
 * Simple LRU cache with TTL.
 */
class TtlCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=60000] - TTL in milliseconds per entry.
   * @param {number} [options.maxEntries=50] - Max entries before LRU eviction kicks in.
   */
  constructor({ ttlMs = DEFAULT_CACHE_TTL_MS, maxEntries = DEFAULT_CACHE_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map(); // key -> { value, expiresAt }
  }

  /**
   * Retrieve a value by key. Returns undefined if the key is missing or expired.
   * On a hit the entry is moved to the end (most-recently-used position).
   * @param {string} key - Cache key.
   * @returns {*|undefined} Cached value, or undefined if not found / expired.
   */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end for LRU
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /**
   * Store a value under the given key, setting its TTL from the cache config.
   * Evicts the oldest entry when at capacity.
   * @param {string} key - Cache key.
   * @param {*} value - Value to cache.
   */
  set(key, value) {
    // Evict oldest if at capacity
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this.map.clear();
  }

  /**
   * Current number of entries in the cache.
   * @returns {number}
   */
  get size() {
    return this.map.size;
  }
}

module.exports = {
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_MAX_ENTRIES,
  getLocalTimezone,
  getOddsHistoryLookbackHours,
  getCacheTtlMs,
  getCacheMaxEntries,
  TtlCache
};
