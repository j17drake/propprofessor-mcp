'use strict';

const cp = require('child_process');
const { fetchGoogleNews, fetchEspnSearch } = require('./propprofessor-news-sources');
const { scoreTweet, scoreNewsArticle, assessRiskFlag } = require('./propprofessor-source-authority');
const { LruCache } = require('./propprofessor-lru-cache');

// Note: same as propprofessor-news-sources.js, we cannot capture
// promisify(execFile) at module load time because tests mock cp.execFile by
// reassignment. Use a fresh promise on each call so the mock is honored.
const pExecFile = (...args) => new Promise((resolve, reject) => {
  cp.execFile(...args, (err, stdout, stderr) => {
    if (err) return reject(err);
    resolve({ stdout, stderr });
  });
});

const X_API_PATH = process.env.HOME + '/.hermes/skills/social-media/nitter-session-api/scripts/x-api.py';
const DEFAULT_COUNT = 30;
const EXEC_TIMEOUT_MS = 15000;
const NEWS_TOP_N = 5;
const ESPN_FALLBACK_TOP_N = 10;

// Smart cache: 30-minute default TTL, 5-minute TTL when riskFlag is 'high' so
// the next call re-checks for a fast-changing injury. 200 entries is enough
// for ~all active players across a slate (NBA ~12, MLB ~15, Tennis ~20, plus
// football/soccer/other). Cron jobs hammering this won't bloat.
const _ctxCache = new LruCache(200);
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const HIGH_RISK_TTL_MS = 5 * 60 * 1000;

function cacheKey(player, sport, gameTime, maxAgeMinutes) {
  // Lowercase the player name so "Frances Tiafoe" and "frances tiafoe" hit the same entry.
  // Sport is also lowercased to normalize case variants.
  return `${String(player || '').toLowerCase()}|${String(sport || '').toLowerCase()}|${gameTime || ''}|${maxAgeMinutes || 60}`;
}

/**
 * Drop every cached entry for a given player+sport (used by the cron pipeline
 * when a high-authority tweet surfaces — bust the cache so the next call
 * re-fetches and re-scores).
 */
function invalidatePlayer(player, sport) {
  return _ctxCache.deleteMatching(cacheKey(player, sport, '', 60));
}

async function searchX(query, _count = DEFAULT_COUNT) {
  try {
    const { stdout } = await pExecFile('python3', [X_API_PATH, 'search', query], { timeout: EXEC_TIMEOUT_MS });
    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      return { error: typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error), tweets: [] };
    }
    return { error: null, tweets: extractTweets(parsed) };
  } catch (err) {
    return { error: err.message || String(err), tweets: [] };
  }
}

function extractTweets(searchResponse) {
  const tweets = [];
  if (!searchResponse || typeof searchResponse !== 'object') return tweets;
  const instructions = searchResponse?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
  for (const instr of instructions) {
    if (instr.type !== 'TimelineAddEntries') continue;
    for (const entry of instr.entries || []) {
      const result = entry?.content?.itemContent?.tweet_results?.result;
      if (!result) continue;
      const legacy = result.legacy || {};
      const userLegacy = result.core?.user_results?.result?.legacy || {};
      const userCore = result.core?.user_results?.result?.core || {};
      tweets.push({
        text: legacy.full_text || '',
        author: userLegacy.screen_name || userCore.screen_name || '',
        authorName: userLegacy.name || userCore.name || '',
        createdAt: legacy.created_at || '',
        favoriteCount: legacy.favorite_count || 0,
        retweetCount: legacy.retweet_count || 0,
        isRetweet: !!legacy.retweeted_status_result,
        isVerified: !!userLegacy.verified || !!userCore.verified || false,
      });
    }
  }
  return tweets;
}

function buildQuery({ player, sport }) {
  if (!player) return '';
  return sport && sport !== 'Tennis' ? `${player} ${sport}` : player;
}

async function getPlayerContext({ player, sport, gameTime, maxAgeMinutes = 60, _bypassCache = false }) {
  const key = cacheKey(player, sport, gameTime, maxAgeMinutes);
  if (!_bypassCache) {
    const cached = _ctxCache.get(key);
    if (cached) {
      return { ...cached, cached: true, fetchedAt: cached.fetchedAt };
    }
  }

  const query = buildQuery({ player, sport });
  const { tweets, error } = await searchX(query);

  // Decide source label and fetch news accordingly.
  // - tweets present: source = 'x-direct' or 'combined' (if we also pull news)
  // - tweets empty: fall back to Google News RSS, then ESPN
  // - all sources empty: source = 'empty'
  let news = [];
  let source;

  if (tweets.length > 0) {
    source = 'x-direct';
    // Also fetch a small news batch as a quality layer — beat-reporter articles
    // can surface context that X might miss. Don't downgrade the source if news
    // is empty, but upgrade to 'combined' when both succeed.
    news = await fetchGoogleNews(query, NEWS_TOP_N);
    if (news.length > 0) source = 'combined';
  } else {
    news = await fetchGoogleNews(query, ESPN_FALLBACK_TOP_N);
    if (news.length === 0) {
      news = await fetchEspnSearch(query);
    }
    source = news.length > 0 ? 'news-fallback' : 'empty';
  }

  // Apply source authority scoring to each item
  const scoredTweets = tweets.map(t => ({ ...t, authorityScore: scoreTweet(t, sport) }));
  const scoredNews = news.map(n => ({ ...n, authorityScore: scoreNewsArticle(n, sport) }));
  const { riskFlag, riskTrigger } = assessRiskFlag(scoredTweets, scoredNews);

  const result = {
    player,
    sport: sport || null,
    gameTime: gameTime || null,
    query,
    tweets: scoredTweets,
    news: scoredNews,
    error,
    source,
    riskFlag,
    riskTrigger,
    fetchedAt: new Date().toISOString(),
  };

  // Cache with smart TTL: short when risk is high (data may update fast),
  // normal 30 min otherwise. Note we cache BEFORE we know the next caller's
  // intent, so this is the call where risk was computed.
  const ttl = riskFlag === 'high' ? HIGH_RISK_TTL_MS : DEFAULT_TTL_MS;
  _ctxCache.set(key, result, ttl);

  return { ...result, cached: false };
}

module.exports = {
  getPlayerContext,
  searchX,
  extractTweets,
  buildQuery,
  invalidatePlayer,
  _ctxCache,
  cacheKey,
  DEFAULT_TTL_MS,
  HIGH_RISK_TTL_MS,
};
