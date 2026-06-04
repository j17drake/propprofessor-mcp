'use strict';

const DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS = 6;
const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute
const DEFAULT_CACHE_MAX_ENTRIES = 50;

function getLocalTimezone() {
  return process.env.LOCAL_TIMEZONE || 'America/Chicago';
}

function getOddsHistoryLookbackHours(value = process.env.PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS;
}

function getCacheTtlMs() {
  const parsed = Number(process.env.PROPPROFESSOR_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function getCacheMaxEntries() {
  const parsed = Number(process.env.PROPPROFESSOR_CACHE_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_MAX_ENTRIES;
}

/**
 * Simple LRU cache with TTL.
 */
class TtlCache {
  constructor({ ttlMs = DEFAULT_CACHE_TTL_MS, maxEntries = DEFAULT_CACHE_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map(); // key -> { value, expiresAt }
  }

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

  set(key, value) {
    // Evict oldest if at capacity
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear() {
    this.map.clear();
  }

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
