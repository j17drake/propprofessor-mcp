'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyExecutionQuality } = require('../lib/screen-summary');

describe('classifyExecutionQuality', () => {
  it('marks off-market price as bad not best', () => {
    assert.equal(classifyExecutionQuality({ targetOdds: -185, comparisonOdds: [-4900, -9900] }), 'bad');
  });
  it('marks on-market best as best', () => {
    assert.equal(classifyExecutionQuality({ targetOdds: -110, comparisonOdds: [-112, -115] }), 'best');
  });
  it('marks near-best as playable', () => {
    assert.equal(classifyExecutionQuality({ targetOdds: -120, comparisonOdds: [-115, -125] }), 'playable');
  });
});
