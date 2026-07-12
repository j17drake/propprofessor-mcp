'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { createPropProfessorClient } = require('../lib/propprofessor-api');

// Regression guard for the "5 plays then 0 on back-to-back calls" flakiness:
// the live backend intermittently returns 0 rows. If an empty response were
// cached, a second call would return the pinned empty. We assert the cache
// NEVER pins an empty response — the second call must re-fan-out.
//
// We mock at the CLIENT level so the real runLeagueScreen cache path
// (scripts/server/handlers.js) is exercised. The mock returns an empty
// payload on the first call, a parseable one on the second.
function makeClient() {
  let callCount = 0;
  const client = createPropProfessorClient();
  const emptyPayload = { game_data: [] };
  const realPayload = {
    game_data: [
      {
        homeTeam: 'A',
        awayTeam: 'B',
        selections: { ml: { odds: { NoVigApp: -110 }, consensus: {} } } }
    ]
  };
  client.queryScreenOddsBestComps = async () => {
    callCount++;
    return callCount === 1 ? emptyPayload : realPayload;
  };
  client.queryScreenOdds = client.queryScreenOddsBestComps;
  return { client, getCalls: () => callCount };
}

describe('screen cache does not pin empty responses', () => {
  it('re-fetches when the first call returns 0 rows (empty not cached)', async () => {
    const { client, getCalls } = makeClient();
    const handlers = createMcpHandlers({ client });
    const args = { leagues: ['WNBA'], book: 'NoVigApp', limit: 3, validate: false };

    const first = await handlers.quick_screen(args);
    const second = await handlers.quick_screen(args);

    // quick_screen fans out ~6 sub-calls per invocation. If the empty first
    // response had been cached, the second invocation would serve all 6 from
    // cache (total calls === 6). Since empties are NOT cached, both
    // invocations fully re-fetch (total calls === 12).
    assert.equal(getCalls(), 12, 'empty responses must not be cached — second call re-fetches');
    const firstCount = (first.leagues || []).reduce((s, l) => s + (l.count || 0), 0);
    assert.equal(firstCount, 0, 'first call returned empty (mock behavior)');
  });
});
