'use strict';

/**
 * Run player_context research on a list of ranked rows. Used by screen_ranked,
 * recommended_bets, and novig_screen as a pre-flight to attach risk flags
 * alongside the ranked plays.
 *
 * Why this lives in its own module:
 * - The runner is reused across 3+ handlers with the same shape and the same
 *   error-handling contract. Inlining it in each handler would duplicate the
 *   player-name extraction, the per-row try/catch, and the result aggregation.
 * - Centralizes the "do this in parallel" question. For now we run sequentially
 *   to keep the existing player_context cache warm (subsequent calls in the
 *   same batch hit cache) and to avoid hammering X/Google News from a single
 *   MCP call. If we ever need parallel: Promise.all with a small concurrency
 *   cap (e.g. 3) is the right move.
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
 * @returns {Promise<{results: Array<Object>, errors: number}>} results array
 *   contains { player, game, league, market, start, riskFlag, riskSummary,
 *   topTweet, cached, fetchedAt }.
 */

async function runResearchOnTopRows({ rows, limit = 10, playerContextFn, maxAgeMinutes = 60 } = {}) {
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

  const results = [];
  let errors = 0;
  for (const row of top) {
    const player = String(row.selection || row.participant || row.pick || '').trim();
    if (!player) continue;
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
        results.push({ player, game, league, market, start, riskFlag: 'unknown', error: 'no_context' });
        errors += 1;
        continue;
      }
      results.push({
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
      });
    } catch (error) {
      results.push({
        player,
        game,
        league,
        market,
        start,
        riskFlag: 'error',
        error: error?.message || String(error)
      });
      errors += 1;
    }
  }
  return { results, errors };
}

module.exports = { runResearchOnTopRows };
