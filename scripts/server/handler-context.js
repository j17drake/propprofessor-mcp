'use strict';

/**
 * Shared context factory for MCP tool handlers.
 *
 * Captures the common dependencies that all 31 handlers need — extracted
 * from the createMcpHandlers() closure in handlers.js so that extracted
 * modules can access them without reaching into the monolith.
 *
 * Usage:
 *   const { createHandlerContext } = require('./handler-context');
 *   const ctx = createHandlerContext({ client });
 *   // ctx.client, ctx.maybeGc, ctx.responseCache, etc.
 */

function createHandlerContext({ client } = {}) {
  const {
    getCacheTtlMs,
    getCacheMaxEntries,
    getCacheMaxEntrySizeBytes
  } = require('../../lib/mcp-runtime-config');
  const { LruCache } = require('../../lib/propprofessor-lru-cache');
  const { clearTierCache } = require('../../lib/propprofessor-risk-score');

  const _maybeGc = typeof global.gc === 'function'
    ? () => { try { global.gc(); } catch { /* best-effort */ } }
    : () => {};

  const responseCache = new LruCache(getCacheMaxEntries(), getCacheMaxEntrySizeBytes());
  const responseCacheTtlMs = getCacheTtlMs();
  const responseCacheMaxEntrySizeBytes = getCacheMaxEntrySizeBytes();

  return {
    client,
    responseCache,
    responseCacheTtlMs,
    responseCacheMaxEntrySizeBytes,
    cacheMaxEntries: getCacheMaxEntries(),
    maybeGc: _maybeGc,
    clearTierCache
  };
}

module.exports = { createHandlerContext };
