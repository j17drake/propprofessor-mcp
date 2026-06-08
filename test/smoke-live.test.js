'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { extractScreenRows, rankLeagueScreenRows } = require('../lib/propprofessor-screen-utils');
const { buildRankedScreenResponse } = require('../lib/propprofessor-mcp-ranked-screen');

// These tests hit the real PropProfessor API.
// They require auth.json at the default location.
// Skipped automatically when auth is missing (CI, etc.).

function hasAuth() {
  const paths = [
    process.env.AUTH_FILE,
    path.join(os.homedir(), '.propprofessor', 'auth.json'),
    path.join(__dirname, '..', 'auth.json')
  ].filter(Boolean);
  return paths.some((p) => {
    try {
      return fs.statSync(p).size > 50;
    } catch {
      return false;
    }
  });
}

const live = hasAuth() ? describe : describe.skip;
const LEAGUE = process.env.PP_TEST_LEAGUE || 'NBA';
const MARKET = process.env.PP_TEST_MARKET || 'Moneyline';
const TIMEOUT = 30_000;

function getActiveDefaultLeague() {
  const month = new Date().getMonth() + 1;
  const isBasketballSeason = month >= 10 || month <= 4;
  return isBasketballSeason ? 'NBA' : 'MLB';
}

live('live API integration tests', { timeout: TIMEOUT }, () => {
  let client;
  let handlers;
  const effectiveLeague = getActiveDefaultLeague();

  before(() => {
    client = createPropProfessorClient();
    handlers = createMcpHandlers({ client });
  });

  it('health_status confirms the endpoint is reachable', async () => {
    const result = await handlers.health_status();
    assert.equal(result.ok, true);
    assert.ok(result.result);
    assert.equal(result.result.endpoints?.screen, 'ok');
  });

  it('screen_raw returns rows for default active league Moneyline', async () => {
    const payload = await client.queryScreenOdds({
      league: effectiveLeague,
      market: MARKET,
      books: ['NoVigApp', 'Pinnacle']
    });
    assert.ok(payload);
    const rows = extractScreenRows(payload);
    assert.ok(rows.length >= 1, `Expected at least 1 screen row for ${effectiveLeague} ${MARKET}, got ${rows.length}`);
    const row = rows[0];
    assert.ok(row.participant || row.selection, 'Row has a participant or selection');
    assert.ok(row.odds || row.currentOdds, 'Row has odds');
  });

  it('screen_ranked returns ranked rows with consensus metadata', async () => {
    const result = await handlers.screen_ranked({
      league: LEAGUE,
      market: MARKET,
      books: ['NoVigApp'],
      limit: 5,
      includeAll: true,
      debug: false
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.result));
    assert.ok(result.result.length >= 1, `Expected ranked rows for ${LEAGUE}`);
    assert.ok(result.resultMeta);
    assert.equal(typeof result.resultMeta.debugEnabled, 'boolean');

    const row = result.result[0];
    assert.ok(row.consensusBookCount >= 0);
    assert.ok(row.screenScore !== undefined, 'Row has screenScore');
    assert.ok(row.odds !== undefined, 'Row has odds');
    assert.ok(row.participant, 'Row has a participant');
  });

  it('ev_candidates requires leagues param', async () => {
    await assert.rejects(
      () => handlers.ev_candidates({}),
      (err) => err.code === 'MISSING_LEAGUES'
    );
  });

  it('ev_candidates returns +EV candidates for NBA', async () => {
    const result = await handlers.ev_candidates({
      leagues: ['NBA'],
      limit: 5,
      minValue: 0
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.result));
    // +EV may return 0 on a quiet slate — structure check only
    if (result.result.length > 0) {
      const row = result.result[0];
      assert.ok(row.participant || row.name || row.selection || row.description, 'Candidate has an identifier');
    }
  });

  it('sharp_plays returns results for NBA', async () => {
    const result = await handlers.sharp_plays({
      leagues: [LEAGUE],
      markets: [MARKET],
      limit: 5,
      debug: false
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.result));
    assert.ok(result.resultMeta);
  });

  it('ranked screen pipeline produces valid output from real data', async () => {
    const payload = await client.queryScreenOddsBestComps({
      league: LEAGUE,
      market: MARKET,
      books: ['NoVigApp'],
      is_live: false
    });
    assert.ok(payload);

    const result = await buildRankedScreenResponse({
      client,
      payloads: [payload],
      args: {
        books: ['NoVigApp'],
        limit: 5,
        includeAll: true,
        lookbackHours: 6,
        debug: false
      },
      league: 'NBA',
      focusBook: 'NoVigApp',
      rankRows: (hydratedRows, { debug } = {}) =>
        rankLeagueScreenRows(hydratedRows, {
          league: LEAGUE,
          market: MARKET,
          limit: 5,
          includeAll: true,
          books: ['NoVigApp'],
          debug
        })
    });

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.result));
    assert.ok(result.resultMeta);
    assert.ok(result.freshness);
  });

  it('tennis screen does not crash (may be empty on quiet days)', async () => {
    const result = await handlers.screen({
      league: 'Tennis',
      market: 'Moneyline',
      book: 'Pinnacle',
      limit: 5,
      includeAll: true,
      debug: false
    });
    assert.equal(result.ok, true);
    assert.equal(result.league, 'Tennis');
    assert.ok(Array.isArray(result.result));
    assert.ok(result.resultMeta || result.warning);
  });

  it('all_slates returns consolidated results', async () => {
    const result = await handlers.all_slates({
      leagues: [LEAGUE],
      market: MARKET,
      limit: 3,
      includeAll: true
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.consolidated));
    assert.ok(result.leagueMeta);
    assert.ok(result.leaguesQueried);
    assert.ok(Number.isFinite(result.totalPlays));
  });
});
