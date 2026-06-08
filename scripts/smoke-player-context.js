'use strict';

/**
 * Live smoke test for query_player_context. Hits real Nitter RSS (local instance),
 * X (via nitter-session-api), Google News RSS, and ESPN search. Run as a one-off
 * before shipping the skill update so we know the whole stack works end-to-end,
 * not just in unit tests with mocks.
 *
 * Usage:
 *   node scripts/smoke-player-context.js
 *   PLAYER="Luka Doncic" SPORT="NBA" node scripts/smoke-player-context.js
 *   NITTER_BASE="http://localhost:8080" node scripts/smoke-player-context.js
 *
 * Exit 0 on success (got tweets or news), 1 on any failure.
 *
 * Skipped in CI: this test calls live external APIs. Requires either a local
 * Nitter instance (set NITTER_BASE) or an active X session cookie
 * (~/.hermes/sessions.jsonl). Run manually before each release of the
 * player-context layer.
 */

const { getPlayerContext } = require('../lib/propprofessor-player-context');

const DEFAULT_PLAYER = 'Frances Tiafoe';
const DEFAULT_SPORT = 'Tennis';

async function main() {
  const player = process.env.PLAYER || DEFAULT_PLAYER;
  const sport = process.env.SPORT || DEFAULT_SPORT;
  const useXurl = String(process.env.USE_XURL || 'false').toLowerCase() === 'true';

  console.log(`[smoke-player-context] player="${player}" sport="${sport}" useXurl=${useXurl}`);

  const startMs = Date.now();
  const ctx = await getPlayerContext({ player, sport, useXurl });
  const elapsedMs = Date.now() - startMs;

  const summary = {
    ok: true,
    elapsedMs,
    player: ctx.player,
    sport: ctx.sport,
    query: ctx.query,
    source: ctx.source,
    cached: ctx.cached,
    riskFlag: ctx.riskFlag,
    riskTrigger: ctx.riskTrigger,
    error: ctx.error,
    tweetCount: ctx.tweets.length,
    newsCount: ctx.news.length,
    topTweets: ctx.tweets.slice(0, 3).map((t) => ({
      author: t.author,
      text: (t.text || '').slice(0, 100),
      authorityScore: t.authorityScore,
      isVerified: t.isVerified
    })),
    topNews: ctx.news.slice(0, 3).map((n) => ({
      title: (n.title || '').slice(0, 100),
      source: n.source,
      authorityScore: n.authorityScore
    })),
    fetchedAt: ctx.fetchedAt
  };

  console.log(JSON.stringify(summary, null, 2));

  // Pass criteria: at least one of (tweets, news) is non-empty, AND no error
  const passed = summary.tweetCount + summary.newsCount > 0 && !summary.error;
  if (!passed) {
    console.error('[smoke-player-context] FAIL: no data and/or error');
    process.exitCode = 1;
  } else {
    console.log(`[smoke-player-context] PASS in ${elapsedMs}ms`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
