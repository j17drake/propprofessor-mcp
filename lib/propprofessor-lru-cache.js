'use strict';

/**
 * Tiny in-memory LRU cache with per-entry TTL.
 *
 * - maxEntries: cap on number of keys (default 200) — evicts least-recently-used
 * - get(key): returns value if present and not expired; touches LRU position
 * - set(key, value, ttlMs): inserts/replaces; ttlMs is per-entry
 * - delete(key): removes a single key
 * - deleteMatching(prefix): removes all keys starting with prefix (used for player-bust invalidation)
 * - clear(): drop everything
 *
 * Time is wall-clock Date.now() — no testability hooks for fake clocks. Tests
 * that need to control time use real setTimeout (small values).
 */
class LruCache {
  /**
   * @param {number} [maxEntries=200] - Maximum number of entries before LRU eviction kicks in.
   */
  constructor(maxEntries = 200) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('LruCache: maxEntries must be a positive integer');
    }
    this.max = maxEntries;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Retrieve a value by key. Touches LRU position on hit.
   * @param {string} key
   * @returns {*|undefined} The stored value, or undefined if missing or expired.
   */
  get(key) {
    if (!this.map.has(key)) {
      this.misses++;
      return undefined;
    }
    const entry = this.map.get(key);
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU touch: re-insert to move to "most recent" position
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /**
   * Check if a key exists and is not expired.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (!this.map.has(key)) return false;
    const entry = this.map.get(key);
    return Date.now() <= entry.expires;
  }

  /**
   * Insert or replace an entry with a per-entry TTL.
   * Evicts the least-recently-used entry if at capacity.
   * @param {string} key
   * @param {*} value
   * @param {number} ttlMs - Time-to-live in milliseconds (must be positive).
   */
  set(key, value, ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('LruCache.set: ttlMs must be a positive number');
    }
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // Evict oldest (first key in Map iteration order)
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
      this.evictions++;
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  /**
   * Remove a single key from the cache.
   * @param {string} key
   * @returns {boolean} True if the key existed and was deleted.
   */
  delete(key) {
    return this.map.delete(key);
  }

  /**
   * Remove all keys that start with a given prefix (pattern-based invalidation).
   * @param {string} prefix
   * @returns {number} Number of entries deleted.
   */
  deleteMatching(prefix) {
    let count = 0;
    for (const key of Array.from(this.map.keys())) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Remove all entries from the cache.
   */
  clear() {
    this.map.clear();
  }

  /**
   * Return the number of non-expired entries currently in the cache.
   * @returns {number}
   */
  size() {
    // Count only non-expired entries
    let count = 0;
    const now = Date.now();
    for (const { expires } of this.map.values()) {
      if (now <= expires) count++;
    }
    return count;
  }

  /**
   * Return a snapshot of cache usage statistics.
   * @returns {{size: number, max: number, hits: number, misses: number, evictions: number}}
   */
  stats() {
    return {
      size: this.size(),
      max: this.max,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    };
  }
}

module.exports = { LruCache };
