'use strict';

const cp = require('child_process');
// Note: we cannot capture promisify(execFile) at module load time because
// tests mock cp.execFile by reassignment, and the promisified wrapper would
// hold the original reference. Instead we re-create the promise on each call.
const pExecFile = (...args) => new Promise((resolve, reject) => {
  cp.execFile(...args, (err, stdout, stderr) => {
    if (err) return reject(err);
    resolve({ stdout, stderr });
  });
});

const CURL_TIMEOUT_MS = 10000;
const DEFAULT_NEWS_RESULTS = 10;

function buildGoogleNewsUrl(query) {
  // Google News legacy public RSS — no API key, no rate limit.
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function buildEspnSearchUrl(query) {
  return `https://www.espn.com/search/_/q/${encodeURIComponent(query)}`;
}

function stripCdata(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Parse a Google News RSS XML blob into a flat array of { title, link, pubDate, source }.
 * Returns an empty array on any parse failure (graceful degradation).
 */
function parseRss(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
    items.push({
      title: stripCdata(rawTitle).trim(),
      link: link.trim(),
      pubDate: pubDate.trim(),
      source: stripCdata(source).trim(),
    });
  }
  return items;
}

/**
 * Parse ESPN search HTML for relevant article links.
 * Looks for <a href="https://*.espn.com/...">TITLE</a> patterns.
 * Returns at most 10 results.
 */
function parseEspnSearch(html) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const items = [];
  const re = /<a[^>]*href="(https:\/\/(?:www\.)?espn\.com\/[^"]+)"[^>]*>([^<]{10,300})<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({
      title: m[2].trim(),
      link: m[1],
      pubDate: '',
      source: 'ESPN',
    });
    if (items.length >= 10) break;
  }
  return items;
}

/**
 * Fetch recent news articles for a query from Google News RSS.
 * Returns up to maxResults items. Empty array on any error.
 */
async function fetchGoogleNews(query, maxResults = DEFAULT_NEWS_RESULTS) {
  try {
    const url = buildGoogleNewsUrl(query);
    const { stdout } = await pExecFile('curl', ['-sL', '--max-time', String(CURL_TIMEOUT_MS / 1000), url], { timeout: CURL_TIMEOUT_MS });
    return parseRss(stdout).slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * Fetch ESPN search results for a query. Used as a secondary fallback when
 * Google News returns nothing. Empty array on any error.
 */
async function fetchEspnSearch(query) {
  try {
    const url = buildEspnSearchUrl(query);
    const { stdout } = await pExecFile('curl', ['-sL', '--max-time', String(CURL_TIMEOUT_MS / 1000), url], { timeout: CURL_TIMEOUT_MS });
    return parseEspnSearch(stdout);
  } catch {
    return [];
  }
}

module.exports = {
  fetchGoogleNews,
  fetchEspnSearch,
  parseRss,
  parseEspnSearch,
  buildGoogleNewsUrl,
  buildEspnSearchUrl,
  stripCdata,
};
