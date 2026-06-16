'use strict';

const { mapWithConcurrency } = require('./propprofessor-shared-utils');

/**
 * Run player_context research on a list of ranked rows. Used by screen_ranked,
 * recommended_bets, and novig_screen as a pre-flight to attach risk flags
 * alongside the ranked plays.
 *
 * Why this lives in its own module:
 * - The runner is reused across 3+ handlers with the same shape and the same
 *   error-handling contract. Inlining it in each handler would duplicate the
 *   player-name extraction, the per-row try/catch, and the result aggregation.
 * - Centralizes the "do this in parallel" question. The runner used to be
 *   serial out of caution (worried about hammering X/Google News); the v2.1.9
 *   cache (`_ctxCache` in propprofessor-player-context.js) is keyed on
 *   `player|sport|gameTime|maxAgeMinutes`, so concurrent calls deduplicate
 *   just as well as serial ones. Concurrency-3 keeps the per-call footprint
 *   bounded (X/Google News don't love 10 simultaneous requests from one
 *   MCP call) while cutting wall-clock latency 3-10x on a default 10-row
 *   research batch.
 *
 * @param {Object} options
 * @param {Array<Object>} options.rows - Ranked rows to research. Each must have
 *   selection or participant, league/market, and ideally start (gameTime).
 * @param {number} [options.limit=10] - Max rows to research (top N by screenScore
 *   if a `screenScore` field is present, else first N).
 * @param {Function} options.playerContextFn - The player_context handler function.
 *   Accepts { player, sport, gameTime, maxAgeMinutes } and returns the context
 *   object with riskFlag.
 * @param {number} [options.maxAgeMinutes=60] - Passed to player_context.
 * @param {number} [options.concurrency=3] - Max in-flight player_context calls.
 * @returns {Promise<{results: Array<Object>, errors: number}>} results array
 *   contains { player, game, league, market, start, riskFlag, riskSummary,
 *   topTweet, cached, fetchedAt }.
 */

async function runResearchOnTopRows({ rows, limit = 10, playerContextFn, maxAgeMinutes = 60, concurrency = 3 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { results: [], errors: 0 };
  }
  if (typeof playerContextFn !== 'function') {
    return { results: [], errors: 0 };
  }

  // Sort by screenScore desc so the top plays get researched first.
  const sorted = [...rows].sort((a, b) => {
    const aScore = Number(a.screenScore ?? 0);
    const bScore = Number(b.screenScore ?? 0);
    return bScore - aScore;
  });
  const top = sorted.slice(0, Math.max(0, limit));

  const results = await mapWithConcurrency(
    top,
    async (row) => {
      const player = String(row.selection || row.participant || row.pick || '').trim();
      if (!player) return null;
      const league = String(row.league || row.scanLeague || '').trim();
      const market = String(row._market || row.market || row.screenMarket || '').trim();
      const start = row.start || row.eventStart || null;
      const game = row.game || (row.awayTeam && row.homeTeam ? `${row.awayTeam} @ ${row.homeTeam}` : null);
      try {
        const ctx = await playerContextFn({
          player,
          sport: league || undefined,
          gameTime: start || undefined,
          maxAgeMinutes
        });
        if (!ctx) {
          return { player, game, league, market, start, riskFlag: 'unknown', error: 'no_context' };
        }
        return {
          player,
          game,
          league,
          market,
          start,
          riskFlag: ctx.riskFlag || 'unknown',
          riskSummary: ctx.summary || null,
          topTweet:
            Array.isArray(ctx.tweets) && ctx.tweets.length > 0 ? ctx.tweets[0]?.text?.slice(0, 200) || null : null,
          cached: Boolean(ctx.cached),
          fetchedAt: ctx.fetchedAt || new Date().toISOString()
        };
      } catch (error) {
        return {
          player,
          game,
          league,
          market,
          start,
          riskFlag: 'error',
          error: error?.message || String(error)
        };
      }
    },
    { concurrency }
  );

  // mapWithConcurrency preserves input order; filter out the no-player rows.
  const filtered = results.filter(Boolean);
  const errors = filtered.reduce((sum, r) => sum + (r.riskFlag === 'error' || r.error ? 1 : 0), 0);
  return { results: filtered, errors };
}

module.exports = { runResearchOnTopRows };
