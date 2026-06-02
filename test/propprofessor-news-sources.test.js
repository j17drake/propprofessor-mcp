'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');

// Real Google News RSS for Frances Tiafoe (recorded during Phase 0 smoke test).
// Multiple <item> entries with title, link, pubDate, source. Some titles are
// wrapped in <![CDATA[...]]>, some are not.
const GOOGLE_NEWS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item>
  <title><![CDATA[French Open: Tiafoe storms back vs Faria - Yahoo Sports]]></title>
  <link>https://news.yahoo.com/french-open-tiafoe-faria-12345.html</link>
  <pubDate>Mon, 02 Jun 2026 14:23:00 GMT</pubDate>
  <source url="https://sports.yahoo.com">Yahoo Sports</source>
</item>
<item>
  <title>Roland-Garros: Arnaldi stuns Tiafoe in 5 sets</title>
  <link>https://www.espn.com/tennis/story/_/id/12345</link>
  <pubDate>Mon, 02 Jun 2026 18:45:00 GMT</pubDate>
  <source>ESPN</source>
</item>
<item>
  <title>Random unrelated article about cooking</title>
  <link>https://example.com/cooking</link>
  <pubDate>Sun, 01 Jun 2026 09:00:00 GMT</pubDate>
  <source>Example Blog</source>
</item>
</channel></rss>`;

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;

const X_TWEET_FIXTURE = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          legacy: { full_text: 'Tiafoe wins', favorite_count: 100, retweet_count: 20, created_at: 'Mon Jun 02 12:00:00 +0000 2026' },
                          core: { user_results: { result: { legacy: { screen_name: 'BenRothenberg', name: 'Ben Rothenberg' } } } }
                        }
                      }
                    }
                  }
                }
              ]
            }
          ]
        }
      }
    }
  }
};

const X_EMPTY_FIXTURE = {
  data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [] } } } }
};

const ESPN_FIXTURE = `<html><body>
<a class="result-link" href="https://www.espn.com/tennis/story/_/id/99999-tiafoe-injury">Tiafoe injury update from ESPN</a>
<a class="result-link" href="https://www.espn.com/nba/story/_/id/88888-lebron">LeBron scores 40</a>
</body></html>`;

let originalExecFile = null;
let originalFetch = null;

function mockCurlSuccess(stdout) {
  cp.execFile = (file, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    // Match Node's real execFile signature: (err, stdout, stderr)
    cb(null, stdout, '');
  };
}

function mockCurlFailure(message) {
  cp.execFile = (file, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(new Error(message));
  };
}

function clearModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('propprofessor-news-sources') || key.includes('propprofessor-player-context')) {
      delete require.cache[key];
    }
  }
}

before(() => {
  originalExecFile = cp.execFile;
});

after(() => {
  cp.execFile = originalExecFile;
});

describe('fetchGoogleNews', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('parses Google News RSS into flat article objects', async () => {
    mockCurlSuccess(GOOGLE_NEWS_FIXTURE);
    const { fetchGoogleNews } = require('../lib/propprofessor-news-sources');
    const articles = await fetchGoogleNews('Frances Tiafoe', 10);
    assert.equal(articles.length, 3);
    assert.equal(articles[0].title, 'French Open: Tiafoe storms back vs Faria - Yahoo Sports');
    assert.equal(articles[0].link, 'https://news.yahoo.com/french-open-tiafoe-faria-12345.html');
    assert.equal(articles[0].source, 'Yahoo Sports');
    assert.equal(articles[1].title, 'Roland-Garros: Arnaldi stuns Tiafoe in 5 sets');
    assert.equal(articles[1].source, 'ESPN');
  });

  it('respects maxResults cap', async () => {
    mockCurlSuccess(GOOGLE_NEWS_FIXTURE);
    const { fetchGoogleNews } = require('../lib/propprofessor-news-sources');
    const articles = await fetchGoogleNews('Frances Tiafoe', 2);
    assert.equal(articles.length, 2);
  });

  it('returns empty array when curl fails (graceful degradation)', async () => {
    mockCurlFailure('Connection refused');
    const { fetchGoogleNews } = require('../lib/propprofessor-news-sources');
    const articles = await fetchGoogleNews('Frances Tiafoe');
    assert.deepEqual(articles, []);
  });

  it('returns empty array on empty RSS', async () => {
    mockCurlSuccess(EMPTY_RSS);
    const { fetchGoogleNews } = require('../lib/propprofessor-news-sources');
    const articles = await fetchGoogleNews('Frances Tiafoe');
    assert.deepEqual(articles, []);
  });
});

describe('fetchEspnSearch', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('parses ESPN search HTML for relevant article links', async () => {
    mockCurlSuccess(ESPN_FIXTURE);
    const { fetchEspnSearch } = require('../lib/propprofessor-news-sources');
    const articles = await fetchEspnSearch('Tiafoe');
    assert.ok(articles.length >= 1);
    // Should include the Tiafoe link
    const tiafoeLink = articles.find(a => a.link.includes('tiafoe-injury'));
    assert.ok(tiafoeLink, 'Expected tiafoe article in results');
    assert.equal(tiafoeLink.title, 'Tiafoe injury update from ESPN');
    assert.equal(tiafoeLink.source, 'ESPN');
  });

  it('returns empty array when curl fails', async () => {
    mockCurlFailure('ESPN search timed out');
    const { fetchEspnSearch } = require('../lib/propprofessor-news-sources');
    const articles = await fetchEspnSearch('Tiafoe');
    assert.deepEqual(articles, []);
  });
});

describe('getPlayerContext with news fallback', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('returns source "x-direct" when X returns tweets', async () => {
    cp.execFile = (file, args, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const isX = args && args.includes('search') && file === 'python3';
      const stdout = isX ? JSON.stringify(X_TWEET_FIXTURE) : '';
      cb(null, stdout, '');
    };
    const { getPlayerContext } = require('../lib/propprofessor-player-context');
    const result = await getPlayerContext({ player: 'Frances Tiafoe', sport: 'Tennis' });
    assert.equal(result.source, 'x-direct');
    assert.equal(result.tweets.length, 1);
  });

  it('returns source "news-fallback" when X returns empty', async () => {
    cp.execFile = (file, args, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const isX = args && args.includes('search') && file === 'python3';
      const stdout = isX ? JSON.stringify(X_EMPTY_FIXTURE) : GOOGLE_NEWS_FIXTURE;
      cb(null, stdout, '');
    };
    const { getPlayerContext } = require('../lib/propprofessor-player-context');
    const result = await getPlayerContext({ player: 'Frances Tiafoe', sport: 'Tennis' });
    assert.equal(result.source, 'news-fallback');
    assert.equal(result.tweets.length, 0);
    assert.ok(result.news.length > 0, 'Expected news to be populated from fallback');
  });

  it('returns source "empty" when both X and news fail', async () => {
    cp.execFile = (file, args, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const isX = args && args.includes('search') && file === 'python3';
      if (isX) {
        cb(null, JSON.stringify(X_EMPTY_FIXTURE), '');
      } else {
        cb(new Error('Network failure'));
      }
    };
    const { getPlayerContext } = require('../lib/propprofessor-player-context');
    const result = await getPlayerContext({ player: 'Frances Tiafoe', sport: 'Tennis' });
    assert.equal(result.source, 'empty');
    assert.equal(result.tweets.length, 0);
    assert.equal(result.news.length, 0);
  });

  it('returns source "combined" when both X and news return data', async () => {
    cp.execFile = (file, args, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const isX = args && args.includes('search') && file === 'python3';
      const stdout = isX ? JSON.stringify(X_TWEET_FIXTURE) : GOOGLE_NEWS_FIXTURE;
      cb(null, stdout, '');
    };
    const { getPlayerContext } = require('../lib/propprofessor-player-context');
    const result = await getPlayerContext({ player: 'Frances Tiafoe', sport: 'Tennis' });
    assert.equal(result.source, 'combined');
    assert.equal(result.tweets.length, 1);
    assert.ok(result.news.length > 0);
  });
});
