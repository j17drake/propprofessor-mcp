'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { createMockClient } = require('./fixtures/mock-client');

describe('live_monitor', () => {
  it('throws when selection is missing', async () => {
    const { client } = createMockClient();
    const handlers = createMcpHandlers({ client });
    await assert.rejects(
      () => handlers.live_monitor({ league: 'NBA' }),
      (err) => err.code === 'MISSING_PARAMS'
    );
  });

  it('throws when league is missing', async () => {
    const { client } = createMockClient();
    const handlers = createMcpHandlers({ client });
    await assert.rejects(
      () => handlers.live_monitor({ selection: 'Lakers' }),
      (err) => err.code === 'MISSING_PARAMS'
    );
  });

  it('returns found: false for a non-existent selection', async () => {
    const { client } = createMockClient();
    const handlers = createMcpHandlers({ client });
    const result = await handlers.live_monitor({
      selection: 'XYZNonExistent',
      league: 'NBA',
      market: 'Moneyline'
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, false);
    assert.equal(result.bookCount, 0);
    assert.equal(result.targetMet, null);
  });

  it('returns odds across books for a real selection', async () => {
    const { client } = createMockClient();
    const handlers = createMcpHandlers({ client });
    const result = await handlers.live_monitor({
      selection: 'Lakers',
      league: 'NBA',
      market: 'Moneyline'
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.selection.toLowerCase(), 'lakers');
    assert.equal(result.league, 'NBA');
    assert.ok(result.bestPrice);
    assert.ok(result.bestPrice.book);
    assert.ok(typeof result.bestPrice.odds === 'number');
    assert.ok(Array.isArray(result.allPrices));
    assert.ok(result.allPrices.length > 0);
    assert.ok(typeof result.bookCount === 'number');
    assert.ok(result.timestamp);
  });

  it('compares current odds to targetOdds', async () => {
    const { client } = createMockClient();
    const handlers = createMcpHandlers({ client });
    // Lakers should be around -150 in the fixture — setting a very low target
    // (-500) should be met easily
    const result = await handlers.live_monitor({
      selection: 'Lakers',
      league: 'NBA',
      market: 'Moneyline',
      targetOdds: -500
    });
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.targetOdds, -500);
    // targetMet should be a boolean since targetOdds was provided
    assert.ok(typeof result.targetMet === 'boolean');
  });
});
