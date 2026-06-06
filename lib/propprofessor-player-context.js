'use strict';

const cp = require('child_process');
const { fetchGoogleNews, fetchEspnSearch, searchNitterRSS } = require('./propprofessor-news-sources');
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

/**
 * Try the xurl CLI as a paid-API escalation path. Used when useXurl=true on
 * query_player_context. xurl needs manual `xurl auth oauth2` setup; until then
 * it returns 401. We detect 401 (and other obvious auth errors) and report
 * source: 'xurl-failed' with a hint to set up auth.
 *
 * xurl's response shape on success is the standard X v2 search response with
 * data[].text, data[].author_id, data[].created_at, includes.users[].username.
 * We normalize to the same shape our extractTweets returns so downstream
 * scoring works without a second branch.
 */
async function fetchViaXurl({ player, sport, maxResults = 20 }) {
  const query = sport && sport !== 'Tennis' ? `${player} ${sport}` : player;
  // xurl exits non-zero on 401/403/etc but still writes the JSON error body
  // to stdout. We need to capture stdout even on non-zero exit, which the
  // default cp.execFile error path doesn't do — it throws an Error with only
  // { code, killed, signal, cmd } on it. So we wrap cp.execFile directly.
  let stdout = '';
  let execErr = null;
  await new Promise((resolve) => {
    cp.execFile('xurl', ['search', query, '-n', String(maxResults)], { timeout: 15_000 }, (err, out) => {
      stdout = out || '';
      execErr = err || null;
      resolve();
    });
  });

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    if (execErr) {
      return { source: 'xurl-failed', error: `xurl exec failed: ${execErr.message || String(execErr)}`, tweets: [], news: [], query };
    }
    return { source: 'xurl-failed', error: 'xurl returned non-JSON output', tweets: [], news: [], query };
  }

  // 401/403/etc from xurl (no auth, rate-limit, etc.) — surface a clean error
  if (parsed && typeof parsed === 'object' && parsed.status && parsed.status >= 400) {
    return {
      source: 'xurl-failed',
      error: `xurl HTTP ${parsed.status}: ${parsed.detail || parsed.title || 'auth likely missing'}. Run \`xurl auth oauth2\` to set up.`,
      tweets: [],
      news: [],
      query,
    };
  }

  return { source: 'xurl', raw: parsed, query };
}

/**
 * Normalize xurl's v2 API response into the same { text, author, authorName, createdAt, ... }
 * shape that extractTweets produces. Returns [] on any shape mismatch (graceful).
 */
function extractXurlTweets(xurlResponse) {
  if (!xurlResponse || typeof xurlResponse !== 'object') return [];
  const data = xurlResponse.data;
  if (!Array.isArray(data)) return [];

  // Build a username lookup from includes.users
  const userMap = new Map();
  if (Array.isArray(xurlResponse.includes?.users)) {
    for (const u of xurlResponse.includes.users) {
      userMap.set(u.id, { username: u.username || '', name: u.name || '' });
    }
  }

  return data.map(t => {
    const user = userMap.get(t.author_id) || {};
    return {
      text: t.text || '',
      author: user.username || '',
      authorName: user.name || '',
      createdAt: t.created_at || '',
      favoriteCount: t.public_metrics?.like_count || 0,
      retweetCount: t.public_metrics?.retweet_count || 0,
      isRetweet: typeof t.text === 'string' && t.text.startsWith('RT '),
      isVerified: false, // xurl v2 search doesn't include verified in default fields
    };
  });
}

const X_API_PATH = process.env.HOME + '/.hermes/skills/social-media/nitter-session-api/scripts/x-api.py';
const DEFAULT_COUNT = 30;
const NITTER_RSS_COUNT = 30;
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

async function getPlayerContext({ player, sport, gameTime, maxAgeMinutes = 60, useXurl = false, _bypassCache = false }) {
  // xurl escalation: opt-in, never the default. Bypasses the cache because
  // the whole point is real-time data when the cached/cheap path is stale.
  if (useXurl) {
    const xurlResult = await fetchViaXurl({ player, sport });
    if (xurlResult.source === 'xurl-failed') {
      return {
        player,
        sport: sport || null,
        gameTime: gameTime || null,
        query: xurlResult.query || null,
        tweets: [],
        news: [],
        error: xurlResult.error,
        source: 'xurl-failed',
        riskFlag: 'unknown',
        riskTrigger: null,
        cached: false,
        fetchedAt: new Date().toISOString(),
      };
    }
    const tweets = extractXurlTweets(xurlResult.raw);
    const scoredTweets = tweets.map(t => ({ ...t, authorityScore: scoreTweet(t, sport) }));
    const { riskFlag, riskTrigger } = assessRiskFlag(scoredTweets, []);
    return {
      player,
      sport: sport || null,
      gameTime: gameTime || null,
      query: xurlResult.query,
      tweets: scoredTweets,
      news: [],
      error: null,
      source: 'xurl',
      riskFlag,
      riskTrigger,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const key = cacheKey(player, sport, gameTime, maxAgeMinutes);
  if (!_bypassCache) {
    const cached = _ctxCache.get(key);
    if (cached) {
      return { ...cached, cached: true, fetchedAt: cached.fetchedAt };
    }
  }

  const query = buildQuery({ player, sport });
  
  // PRIORITY 1: Nitter RSS (fast, no auth, stable, local)
  const nitterTweets = await searchNitterRSS(query, NITTER_RSS_COUNT);
  
  let tweets = [];
  let news = [];
  let source;

  if (nitterTweets.length > 0) {
    tweets = nitterTweets;
    source = 'nitter-rss';
    // Also fetch a small news batch as a quality layer — beat-reporter articles
    // can surface context that X might miss. Don't downgrade the source if news
    // is empty, but upgrade to 'nitter-combined' when both succeed.
    news = await fetchGoogleNews(query, NEWS_TOP_N);
    if (news.length > 0) source = 'nitter-combined';
  } else {
    // PRIORITY 2: Fall back to X GraphQL (current path via nitter-session-api)
    const { tweets: xTweets, error } = await searchX(query);
    tweets = xTweets;

    if (tweets.length > 0) {
      source = 'x-direct';
      news = await fetchGoogleNews(query, NEWS_TOP_N);
      if (news.length > 0) source = 'combined';
    } else {
      // PRIORITY 3/4: News fallbacks (unchanged)
      news = await fetchGoogleNews(query, ESPN_FALLBACK_TOP_N);
      if (news.length === 0) {
        news = await fetchEspnSearch(query);
      }
      source = news.length > 0 ? 'news-fallback' : 'empty';
    }
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
    error: null,
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
  fetchViaXurl,
  extractXurlTweets,
  invalidatePlayer,
  _ctxCache,
  cacheKey,
  DEFAULT_TTL_MS,
  HIGH_RISK_TTL_MS,
};
