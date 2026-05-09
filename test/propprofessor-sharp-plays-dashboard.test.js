'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildQueryString,
  buildResearchDiagnostics,
  cleanResearchSummary,
  createDecisionStore,
  createResearchQueue,
  createSharpPlaysDashboardServer,
  extractStartTime,
  formatOdds,
  formatStartTime,
  formatTimeUntil,
  getMovementNote,
  getPlayActionVerdict,
  getPlayResearchId,
  getPriceStatus,
  getResearchCounts,
  getResearchRiskFlags,
  getTimeBucket,
  isPidAlive,
  isTennisPlay,
  normalizeBookName,
  normalizeDashboardFilters,
  parseDashboardArgv,
  parseResearchVerdict,
  renderFilters,
  renderPage
} = require('../lib/propprofessor-sharp-plays-dashboard');

function createClientStub() {
  return {
    queryScreenOddsBestComps: async () => ({ game_data: [] }),
    queryScreenOdds: async () => ({ game_data: [] }),
    queryOddsHistory: async () => ({
      Pinnacle: [
        { odds: -110, start_ts: 1 },
        { odds: -125, start_ts: 2 }
      ]
    })
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body, json: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

function postForm(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(body).toString();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(payload) }
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sharp plays dashboard helpers', () => {
  it('normalizes filters from query parameters', () => {
    const url = new URL('http://local/?book=NoVigApp&leagues=NBA,MLB&markets=Moneyline,Spread&limit=7&broad=1&includePasses=1');
    const filters = normalizeDashboardFilters(url);
    assert.equal(filters.book, 'NoVigApp');
    assert.deepEqual(filters.leagues, ['NBA', 'MLB']);
    assert.deepEqual(filters.markets, ['Moneyline', 'Spread']);
    assert.equal(filters.limit, 7);
    assert.equal(filters.strict, false);
    assert.equal(filters.includePasses, true);
    assert.equal(filters.timeWindow, 'all');
    assert.equal(filters.hidePlaced, true);
    assert.equal(filters.hideHidden, true);
  });

  it('honors explicit toggle-off query params and hidden select payloads', () => {
    const filters = normalizeDashboardFilters(new URL('http://local/?hidePlaced=0&hideHidden=0&leagues=all&leaguesCsv=NBA,MLB&markets=all&marketsCsv=Moneyline,Spread'));
    assert.equal(filters.hidePlaced, false);
    assert.equal(filters.hideHidden, false);
    assert.deepEqual(filters.leagues, ['NBA', 'MLB']);
    assert.deepEqual(filters.markets, ['Moneyline', 'Spread']);
  });

  it('normalizes Novig aliases to the PropProfessor book label', () => {
    assert.equal(normalizeBookName('Novig'), 'NoVigApp');
    assert.equal(normalizeBookName('NoVig'), 'NoVigApp');
    assert.equal(normalizeBookName('NoVigApp'), 'NoVigApp');
    assert.equal(normalizeDashboardFilters(new URL('http://local/?book=Novig')).book, 'NoVigApp');
  });

  it('supports all dropdown values for leagues and markets', () => {
    const filters = normalizeDashboardFilters(new URL('http://local/?book=NoVig&leagues=all&markets=all'));
    assert.equal(filters.book, 'NoVigApp');
    assert.deepEqual(filters.leagues, ['NBA', 'MLB', 'NHL', 'Tennis', 'WNBA']);
    assert.deepEqual(filters.markets, ['Moneyline', 'Spread', 'Total']);
  });

  it('builds a stable query string for refresh links', () => {
    const query = buildQueryString({
      book: 'Fliff',
      leagues: ['NBA'],
      markets: ['Moneyline'],
      limit: 5,
      scanLimit: 20,
      minConsensusBookCount: 2,
      lookbackHours: 6,
      strict: true,
      timeWindow: 'next1h',
      hidePlaced: true,
      plusMoneyOnly: true
    });
    assert.match(query, /book=Fliff/);
    assert.match(query, /leagues=NBA/);
    assert.match(query, /markets=Moneyline/);
    assert.match(query, /timeWindow=next1h/);
    assert.match(query, /hidePlaced=1/);
    assert.match(query, /plusMoneyOnly=1/);
  });

  it('renders toggle-off sentinels and selected comma-separated filter payloads', () => {
    const html = require('../lib/propprofessor-sharp-plays-dashboard').renderFilters({
      book: 'Fliff',
      leagues: ['NBA', 'MLB'],
      markets: ['Moneyline', 'Spread'],
      limit: 10,
      scanLimit: 30,
      minConsensusBookCount: 2,
      lookbackHours: 6,
      timeWindow: 'all',
      strict: true,
      includePasses: false,
      allowRecentOnly: false,
      hidePlaced: false,
      hideHidden: false,
      unresearchedOnly: false,
      strongSupportOnly: false,
      plusMoneyOnly: false
    });
    assert.match(html, /name="hidePlaced" value="0"/);
    assert.match(html, /name="hideHidden" value="0"/);
    assert.match(html, /name="leaguesCsv" value="NBA,MLB"/);
    assert.match(html, /name="marketsCsv" value="Moneyline,Spread"/);
  });

  it('formats positive American odds with a plus sign', () => {
    assert.equal(formatOdds(120), '+120');
    assert.equal(formatOdds(-115), '-115');
  });

  it('classifies time buckets with same-day and future-day separation', () => {
    const now = '2026-05-09T17:00:00.000Z';
    assert.equal(getTimeBucket({ startTime: '2026-05-09T17:45:00.000Z' }, now), 'next1h');
    assert.equal(getTimeBucket({ startTime: '2026-05-09T21:45:00.000Z' }, now), 'today');
    assert.equal(getTimeBucket({ startTime: '2026-05-10T01:15:00.000Z' }, now), 'future');
  });

  it('parses price status into playable, too expensive, missing, and verify states', () => {
    const playable = getPriceStatus({ odds: 120 }, { summary: 'Verdict: Bet\nPlayable price: +108\nAction: Bet it.' });
    const tooExpensive = getPriceStatus({ odds: 100 }, { summary: 'Verdict: Bet\nPlayable price: +108\nAction: Bet it.' });
    const missing = getPriceStatus({}, { summary: 'Verdict: Bet\nPlayable price: +108\nAction: Bet it.' });
    const verify = getPriceStatus({ odds: 120 }, { summary: 'Verdict: Bet\nAction: Check it.' });
    assert.equal(playable.status, 'Playable');
    assert.equal(tooExpensive.status, 'Too expensive');
    assert.equal(missing.status, 'Missing');
    assert.equal(verify.status, 'Verify');
  });

  it('cleans Hermes CLI chrome from research output', () => {
    const cleaned = cleanResearchSummary(`╭──────────── Hermes Agent v0.13.0 ─────────────╮\n│ Available Tools │\n╰──────────────────────────────────────────────╯\nQuery: Validate this play\nInitializing agent...\n╭─ ⚕ Hermes ───────────────────────────────────╮\n    Verdict: Stale\n    Playable price: n/a\n    Reason:\n    - Already started.\n    Action: Pass.\n╰──────────────────────────────────────────────╯\n\nResume this session with:\n  hermes --resume abc\nSession: abc`);
    assert.equal(cleaned, 'Verdict: Stale\n    Playable price: n/a\n    Reason:\n    - Already started.\n    Action: Pass.');
  });

  it('extracts and formats start times for triage rows', () => {
    const play = {
      startTime: '2026-05-09T19:10:00.000Z',
      game: 'Stars vs Rangers',
      league: 'NBA'
    };
    assert.equal(extractStartTime(play), '2026-05-09T19:10:00.000Z');
    assert.match(formatStartTime(play.startTime, { now: '2026-05-09T17:00:00.000Z', timeZone: 'UTC' }), /May 9, 7:10 PM/);
    assert.equal(formatTimeUntil(play.startTime, { now: '2026-05-09T17:00:00.000Z' }), 'starts in 2h 10m');
    assert.equal(formatTimeUntil('2026-05-09T16:52:00.000Z', { now: '2026-05-09T17:00:00.000Z' }), 'started 8m ago');
    assert.equal(formatTimeUntil(null), 'Start time unavailable');
  });

  it('detects tennis plays and parses research verdicts', () => {
    assert.equal(isTennisPlay({ league: 'Tennis' }), true);
    assert.equal(isTennisPlay({ scanLeague: 'NBA' }), false);
    assert.deepEqual(parseResearchVerdict('Verdict: Bet\nPlayable price: -115\nConfidence: High\nEvidence checked: target-book price and sharp cluster\nAction: Bet it.'), {
      verdict: 'Bet',
      playablePrice: '-115',
      confidence: 'High',
      action: 'Bet it.',
      directTargetBookVerified: true,
      evidenceChecked: 'target-book price and sharp cluster'
    });
  });

  it('flags risky research summaries', () => {
    assert.deepEqual(getResearchRiskFlags('Verdict: Bet\nPlayable price: +108\nConfidence: Low\nEvidence checked: indirect search snippet\nMatchup analysis: none\nAction: Bet it.'), [
      'indirect-target-book-only',
      'low-confidence',
      'no-matchup-analysis'
    ]);
    assert.deepEqual(getResearchRiskFlags('Verdict: Watch\nPlayable price: n/a\nConfidence: Medium\nEvidence checked: current target-book price\nMatchup analysis: done\nAction: Watch.'), ['missing-playable-price']);
    assert.deepEqual(getResearchRiskFlags({
      play: { league: 'Tennis' },
      summary: 'Verdict: Stale\nPlayable price: +110\nConfidence: Medium\nEvidence checked: PP time only\nMatchup analysis: service profiles\nAction: Pass because it already started.'
    }), ['stale-time-only-tennis']);
  });

  it('maps play, research, and decision state into an operator verdict', () => {
    const play = { league: 'NBA', verdict: 'Bet candidate', odds: 115, movementLabel: 'supportive', movementSourceBook: 'Pinnacle' };
    const researchEntry = { summary: 'Verdict: Watch\nPlayable price: +108\nConfidence: Medium\nEvidence checked: target-book price was verified\nAction: Wait for a better price.' };
    const decisionEntry = { status: 'watch' };
    const verdict = getPlayActionVerdict(play, researchEntry, decisionEntry);
    assert.equal(verdict.label, 'Watch price');
    assert.equal(verdict.priceStatus, 'Playable');
    assert.equal(verdict.playablePrice, '+108');
    assert.equal(verdict.directTargetBookVerified, true);
    assert.equal(getMovementNote(play, verdict), 'Supportive movement from Pinnacle.');
  });

  it('counts research queue statuses', () => {
    const counts = getResearchCounts([
      { status: 'queued' },
      { status: 'researching' },
      { status: 'done' },
      { status: 'failed' },
      { status: 'done' }
    ]);
    assert.deepEqual(counts, { queued: 1, researching: 1, done: 2, failed: 1, total: 5 });
  });

  it('marks stale researching entries failed when their process is gone', () => {
    assert.equal(isPidAlive(-999), false);
    const statePath = path.join(os.tmpdir(), `pp-sharp-stale-research-${Date.now()}-${Math.random()}.json`);
    const queue = createResearchQueue({ statePath, runner: () => {} });
    queue.update('stale-job', { id: 'stale-job', status: 'researching', pid: 999999, promptPath: statePath, play: { pick: 'Dead agent' } });
    const entry = queue.get('stale-job');
    assert.equal(entry.status, 'failed');
    assert.match(entry.error, /no longer running/);
  });

  it('warns research agents that PP tennis start times are unreliable', () => {
    const prompt = require('../lib/propprofessor-sharp-plays-dashboard').buildResearchPrompt({
      id: 'tennis-test',
      play: { league: 'Tennis', pick: 'Moutet', game: 'Moutet vs Ruiz', book: 'Fliff', odds: -145 }
    });
    assert.match(prompt, /PropProfessor start times are often wrong/);
    assert.match(prompt, /Do not mark a tennis play stale solely from the PP start time/);
  });

  it('asks research agents to do external context checks instead of only restating movement', () => {
    const prompt = require('../lib/propprofessor-sharp-plays-dashboard').buildResearchPrompt({
      id: 'context-test',
      play: {
        league: 'MLB',
        pick: 'Rangers ML',
        game: 'Rangers vs Astros',
        book: 'Fliff',
        odds: 120,
        movementLabel: 'supportive',
        movementSourceBook: 'Pinnacle',
        selections: {
          null: {
            odds: {
              Fliff: { book: 'Fliff', odds1: 120, liquidity1: 300 },
              Pinnacle: { book: 'Pinnacle', odds1: 110, liquidity1: 1500 }
            }
          }
        },
        lineHistory: [
          { book: 'Pinnacle', odds: 130, time: 1 },
          { book: 'Pinnacle', odds: 110, time: 2 }
        ]
      }
    });
    assert.match(prompt, /Do not just restate the sharp consensus\/movement/);
    assert.match(prompt, /Evidence checked/);
    assert.match(prompt, /Matchup analysis/);
    assert.match(prompt, /Do matchup analysis for the sport/);
    assert.match(prompt, /If web_search\/web_extract\/scrape tools fail with auth/);
    assert.match(prompt, /Use the terminal tool as fallback/);
    assert.match(prompt, /Tavily via TAVILY_API_KEY/);
    assert.match(prompt, /Confidence: Low/);
    assert.match(prompt, /Tennis: compare player form, surface fit, head-to-head/);
    assert.match(prompt, /fatigue\/rest, travel, injury\/retirement risk/);
    assert.match(prompt, /tournament motivation/);
    assert.match(prompt, /ranking\/serve-return profile/);
    assert.match(prompt, /injuries, starters\/goalie\/QB/);
    assert.match(prompt, /park\/weather/);
    assert.match(prompt, /Preferred external sources/);
    assert.match(prompt, /Flashscore, Sofascore, official tournament sites, WTA, ATP/);
    assert.match(prompt, /MLB probable pitchers, lineups, weather/);
    assert.match(prompt, /official injury reports, team reports, goalie\/QB reports/);
    assert.match(prompt, /Do not cite search snippets as proof the target-book price is available/);
    assert.match(prompt, /targetBookPayloadSource/);
    assert.match(prompt, /PropProfessor screen snapshot/);
    assert.match(prompt, /targetBookNeedsManualVerification/);
    assert.match(prompt, /lineHistorySummary/);
    assert.match(prompt, /prices/);
  });

  it('loads ~/.hermes/.env and isolates research agents onto Tavily web search when available', () => {
    const envPath = path.join(os.tmpdir(), `pp-sharp-env-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(envPath, 'TAVILY_API_KEY=tavily-test-key\nEXTRA_VALUE="quoted"\n');
    const oldEnvPath = process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH;
    const oldAllowFirecrawl = process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH;
    const oldHermesHome = process.env.HERMES_HOME;
    try {
      process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH = envPath;
      delete process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH;
      const { buildResearchChildEnv, buildResearchDiagnostics } = require('../lib/propprofessor-sharp-plays-dashboard');
      const childEnv = buildResearchChildEnv();
      const diagnostics = buildResearchDiagnostics({ envFile: envPath });
      assert.equal(childEnv.TAVILY_API_KEY, 'tavily-test-key');
      assert.equal(childEnv.EXTRA_VALUE, 'quoted');
      assert.match(childEnv.HERMES_HOME, /sharp-play-research\/hermes-tavily-home$/);
      assert.equal(diagnostics.tavilyKeyPresent, true);
      assert.equal(diagnostics.allowFirecrawl, false);
      assert.equal(diagnostics.generatedConfigHasMcpServers, false);
      assert.equal(diagnostics.generatedConfigWebBackend, 'tavily');
      const configText = fs.readFileSync(diagnostics.generatedConfigPath, 'utf8');
      assert.match(configText, /search_backend: tavily/);
      assert.match(configText, /use_gateway: false/);
      assert.doesNotMatch(configText, /mcp_servers:/);
      assert.doesNotMatch(JSON.stringify(diagnostics), /tavily-test-key/);
    } finally {
      if (oldEnvPath === undefined) delete process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH;
      else process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH = oldEnvPath;
      if (oldAllowFirecrawl === undefined) delete process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH;
      else process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH = oldAllowFirecrawl;
      if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = oldHermesHome;
      try { fs.unlinkSync(envPath); } catch {}
    }
  });

  it('renders play cards and force-refresh links', () => {
    const play = {
      pick: 'Rangers ML',
      game: 'Rangers vs Stars',
      book: 'Fliff',
      odds: 115,
      verdict: 'Bet candidate',
      movementLabel: 'supportive',
      movementSourceBook: 'Pinnacle',
      sharpPlayScore: 87.2,
      consensusBookCount: 3,
      startTime: '2026-05-09T19:10:00.000Z',
      currentOdds: 115,
      targetBookFetchedAt: '2026-05-08T12:00:00.000Z'
    };
    const researchId = getPlayResearchId(play);
    const html = renderPage({
      filters: normalizeDashboardFilters({ book: 'Fliff', hidePlaced: '1' }),
      diagnostics: { tavilyKeyPresent: true, allowFirecrawl: false, generatedConfigHasMcpServers: false, hermesHome: '/tmp/hermes', generatedConfigPath: '/tmp/hermes-tavily/config.yaml' },
      researchEntries: {
        [researchId]: {
          id: researchId,
          status: 'done',
          updatedAt: '2026-05-08T12:01:00.000Z',
          summary: cleanResearchSummary('╭─ ⚕ Hermes ─╮\nVerdict: Bet\nPlayable price: +108\nConfidence: Low\nEvidence checked: search snippet only\nMatchup analysis: checked\nAction: Bet.\n╰────╯\nResume this session with:\n  hermes --resume abc')
        }
      },
      decisionEntries: {
        [researchId]: { id: researchId, status: 'watch', note: 'keep an eye on price' }
      },
      snapshot: {
        result: [play],
        resultMeta: { scannedRowCount: 12 },
        fetchedAt: '2026-05-08T12:00:00.000Z',
        fetchDurationMs: 50
      }
    });
    assert.match(html, /Sharp Plays Command Center/);
    assert.match(html, /Fast bet\/pass triage with queued agent validation/);
    assert.match(html, /Research Queue/);
    assert.match(html, /Actionable now/);
    assert.match(html, /Rangers ML/);
    assert.match(html, /starts in/);
    assert.match(html, /Mark placed|Placed/);
    assert.match(html, /Hide/);
    assert.match(html, /Watch/);
    assert.match(html, /Pass/);
    assert.match(html, /Clear/);
    assert.match(html, /Research summary/);
    assert.match(html, /Supportive movement from Pinnacle/);
    assert.match(html, /Tavily ready/);
    assert.match(html, /Verify target price/);
    assert.doesNotMatch(html, /Hermes Agent/);
    assert.doesNotMatch(html, /Resume this session/);
    assert.match(html, /Pinnacle/);
    assert.match(html, /\/api\/plays/);
    assert.match(html, /\/api\/decisions/);
    assert.match(html, /\/refresh/);
  });

  it('hides queued and researching rows when unresearched only is enabled', () => {
    const queuedPlay = { pick: 'Queued ML', game: 'Queued vs Live', book: 'Fliff', odds: 110, startTime: '2026-05-09T19:10:00.000Z' };
    const donePlay = { pick: 'Done ML', game: 'Done vs Live', book: 'Fliff', odds: 110, startTime: '2026-05-09T19:10:00.000Z' };
    const queuedId = getPlayResearchId(queuedPlay);
    const doneId = getPlayResearchId(donePlay);
    const html = renderPage({
      filters: normalizeDashboardFilters({ unresearchedOnly: '1', hidePlaced: '0', hideHidden: '0' }),
      researchEntries: {
        [queuedId]: { id: queuedId, status: 'queued', summary: '', updatedAt: '2026-05-08T12:01:00.000Z' },
        [doneId]: { id: doneId, status: 'done', summary: 'Verdict: Pass\nPlayable price: n/a\nAction: Skip.', updatedAt: '2026-05-08T12:02:00.000Z' }
      },
      snapshot: { result: [queuedPlay, donePlay], resultMeta: { scannedRowCount: 2 } }
    });
    assert.doesNotMatch(html, /Queued ML/);
    assert.doesNotMatch(html, /Done ML/);
    assert.match(html, /No clean sharp-supported plays right now/);
  });

  it('reports movement notes and actionable hero stats for mixed research states', () => {
    const betPlay = { pick: 'Bet ML', game: 'Bet vs Live', book: 'Fliff', odds: 125, verdict: 'Bet candidate', movementLabel: 'supportive', movementSourceBook: 'Pinnacle', currentOdds: 125, targetBookFetchedAt: '2026-05-08T12:00:00.000Z' };
    const verifyPlay = { pick: 'Verify ML', game: 'Verify vs Live', book: 'Fliff', odds: 115, verdict: 'Lean', movementLabel: 'mixed', movementSourceBook: 'Circa' };
    const researchEntries = {
      [getPlayResearchId(betPlay)]: { id: getPlayResearchId(betPlay), status: 'done', summary: 'Verdict: Bet\nPlayable price: +108\nConfidence: High\nEvidence checked: target-book price was verified\nMatchup analysis: done\nAction: Bet.' },
      [getPlayResearchId(verifyPlay)]: { id: getPlayResearchId(verifyPlay), status: 'researching', summary: '' }
    };
    const html = renderPage({
      filters: normalizeDashboardFilters({ hidePlaced: '0', hideHidden: '0' }),
      researchEntries,
      diagnostics: { tavilyKeyPresent: false, allowFirecrawl: true, generatedConfigHasMcpServers: true, hermesHome: '/tmp/hermes', generatedConfigPath: '/tmp/hermes/config.yaml' },
      snapshot: { result: [betPlay, verifyPlay], resultMeta: { scannedRowCount: 2 } }
    });
    assert.match(html, /Actionable now/);
    assert.match(html, /Research done \/ needs decision/);
    assert.match(html, /Supportive movement from Pinnacle\./);
    assert.match(html, /Mixed movement from Circa\./);
    assert.match(html, /Bet/);
    assert.match(html, /Verify/);
    assert.match(html, /Config has MCP servers/);
  });
});

describe('sharp plays dashboard server', () => {
  it('serves JSON from the sharp plays scanner', async () => {
    const server = createSharpPlaysDashboardServer({ client: createClientStub() });
    const port = await listen(server);
    try {
      const response = await getJson(port, '/api/plays?book=Fliff&leagues=NBA&markets=Moneyline&limit=2&force=1');
      assert.equal(response.statusCode, 200);
      assert.equal(response.json.ok, true);
      assert.equal(response.json.filters.book, 'Fliff');
      assert.ok(Array.isArray(response.json.result));
      assert.ok(Array.isArray(response.json.research));
    } finally {
      server.close();
    }
  });

  it('exposes the research environment diagnostics without leaking secrets', async () => {
    const envPath = path.join(os.tmpdir(), `pp-sharp-env-endpoint-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(envPath, 'TAVILY_API_KEY=endpoint-secret-key\n');
    const oldEnvPath = process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH;
    try {
      process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH = envPath;
      const server = createSharpPlaysDashboardServer({ client: createClientStub() });
      const port = await listen(server);
      try {
        const response = await getJson(port, '/api/research-env');
        assert.equal(response.statusCode, 200);
        assert.equal(response.json.ok, true);
        assert.equal(response.json.diagnostics.tavilyKeyPresent, true);
        assert.equal(response.json.diagnostics.generatedConfigWebBackend, 'tavily');
        assert.equal(response.json.diagnostics.allowFirecrawl, false);
        assert.doesNotMatch(JSON.stringify(response.json), /endpoint-secret-key/);
      } finally {
        server.close();
      }
    } finally {
      if (oldEnvPath === undefined) delete process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH;
      else process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH = oldEnvPath;
      try { fs.unlinkSync(envPath); } catch {}
    }
  });

  it('supports research queue cleanup actions', async () => {
    const statePath = path.join(os.tmpdir(), `pp-sharp-research-actions-${Date.now()}-${Math.random()}.json`);
    const researchQueue = createResearchQueue({ statePath, runner: (entry, queue) => queue.update(entry.id, { status: 'done', summary: 'Verdict: Bet\nPlayable price: +108\nConfidence: High\nEvidence checked: target-book price was verified\nMatchup analysis: done\nAction: Bet.' }) });
    const server = createSharpPlaysDashboardServer({ client: createClientStub(), researchQueue });
    const port = await listen(server);
    const play = { pick: 'Cleanup ML', game: 'Cleanup vs Live', book: 'Fliff', odds: 115, currentOdds: 115, targetBookFetchedAt: '2026-05-08T12:00:00.000Z' };
    const id = getPlayResearchId(play);
    try {
      await postForm(port, '/actions/research-play?book=Fliff&leagues=NBA&markets=Moneyline', { play: JSON.stringify(play) });
      assert.equal(researchQueue.get(id).status, 'done');
      const clearResponse = await postForm(port, '/actions/research-clear', { id });
      assert.equal(clearResponse.statusCode, 302);
      assert.equal(researchQueue.get(id), null);

      await postForm(port, '/actions/research-play?book=Fliff&leagues=NBA&markets=Moneyline', { play: JSON.stringify(play) });
      researchQueue.update(id, { status: 'failed', error: 'boom' });
      const requeueResponse = await postForm(port, '/actions/research-requeue', { id });
      assert.equal(requeueResponse.statusCode, 302);
      const requeued = researchQueue.get(id);
      assert.equal(requeued.status, 'done');
      assert.equal(requeued.play.pick, 'Cleanup ML');

      researchQueue.update(id, { status: 'failed', error: 'boom' });
      const failId = `${id}-failed`;
      researchQueue.update(failId, { id: failId, status: 'failed', play, filters: {}, summary: 'bad' });
      await postForm(port, '/actions/research-clear-failed', {});
      assert.equal(researchQueue.get(failId), null);
    } finally {
      server.close();
    }
  });

  it('times out stuck research jobs without launching Hermes', async () => {
    const statePath = path.join(os.tmpdir(), `pp-sharp-research-timeout-${Date.now()}-${Math.random()}.json`);
    const scriptPath = path.join(os.tmpdir(), `pp-sharp-research-timeout-script-${Date.now()}-${Math.random()}.sh`);
    fs.writeFileSync(scriptPath, '#!/bin/sh\nsleep 1\n');
    fs.chmodSync(scriptPath, 0o755);
    const originalTimeout = process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS;
    const originalCommand = process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND;
    const researchQueue = createResearchQueue({ statePath });
    const server = createSharpPlaysDashboardServer({ client: createClientStub(), researchQueue });
    const port = await listen(server);
    const play = { pick: 'Timeout ML', game: 'Timeout vs Live', book: 'Fliff', odds: 115, currentOdds: 115, targetBookFetchedAt: '2026-05-08T12:00:00.000Z' };
    const id = getPlayResearchId(play);
    try {
      process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS = '25';
      process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND = scriptPath;
      await postForm(port, '/actions/research-play?book=Fliff&leagues=NBA&markets=Moneyline', { play: JSON.stringify(play) });
      await wait(80);
      const entry = researchQueue.get(id);
      assert.equal(entry.status, 'failed');
      assert.match(entry.error, /timed out/i);
      assert.ok(entry.completedAt);
    } finally {
      if (originalTimeout === undefined) delete process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS;
      else process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS = originalTimeout;
      if (originalCommand === undefined) delete process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND;
      else process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND = originalCommand;
      try { fs.unlinkSync(scriptPath); } catch {}
      server.close();
    }
  });
});
