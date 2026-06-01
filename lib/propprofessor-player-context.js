'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const pExecFile = promisify(execFile);

const X_API_PATH = process.env.HOME + '/.hermes/skills/social-media/nitter-session-api/scripts/x-api.py';
const DEFAULT_COUNT = 30;
const EXEC_TIMEOUT_MS = 15000;

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
  return {
    player,
    sport: sport || null,
    gameTime: gameTime || null,
    query,
    tweets,
    error,
    source: tweets.length > 0 ? 'x-direct' : 'empty',
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getPlayerContext, searchX, extractTweets, buildQuery };
