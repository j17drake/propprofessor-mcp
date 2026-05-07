'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/query-propprofessor');

describe('query-propprofessor CLI parsing', () => {
  it('accepts lookback-hours aliases', () => {
    const dashed = parseArgs(['node', 'query', 'screen', '--lookback-hours', '4']);
    assert.equal(dashed.command, 'screen');
    assert.equal(dashed.opts.lookbackHours, '4');

    const camel = parseArgs(['node', 'query', 'screen', '--lookbackHours', '8']);
    assert.equal(camel.command, 'screen');
    assert.equal(camel.opts.lookbackHours, '8');
  });

  it('accepts debug flags', () => {
    const enabled = parseArgs(['node', 'query', 'screen', '--debug']);
    assert.equal(enabled.opts.debug, true);

    const disabled = parseArgs(['node', 'query', 'screen', '--no-debug']);
    assert.equal(disabled.opts.debug, false);
  });
});
