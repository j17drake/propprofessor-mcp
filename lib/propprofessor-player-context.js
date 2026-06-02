'use strict';

const cp = require('child_process');
const { fetchGoogleNews, fetchEspnSearch } = require('./propprofessor-news-sources');
const { scoreTweet, scoreNewsArticle, assessRiskFlag } = require('./propprofessor-source-authority');

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

async function getPlayerContext({ player, sport, gameTime, maxAgeMinutes: _maxAgeMinutes = 60, _bypassCache = false }) {
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

  return {
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
}

module.exports = { getPlayerContext, searchX, extractTweets, buildQuery };
