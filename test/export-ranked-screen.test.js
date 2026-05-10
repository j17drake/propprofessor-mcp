'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/export-ranked-screen');

describe('export-ranked-screen CLI parsing', () => {
  it('accepts lookback-hours aliases', () => {
    const dashed = parseArgs(['node', 'export', '--lookback-hours', '4']);
    assert.equal(dashed.lookbackHours, '4');

    const camel = parseArgs(['node', 'export', '--lookbackHours', '8']);
    assert.equal(camel.lookbackHours, '8');
  });

  it('accepts debug flags', () => {
    const enabled = parseArgs(['node', 'export', '--debug']);
    assert.equal(enabled.debug, true);

    const disabled = parseArgs(['node', 'export', '--no-debug']);
    assert.equal(disabled.debug, false);
  });
});
