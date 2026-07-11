'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapCandidateRow } = require('../lib/propprofessor-mcp-candidate-mapper');

describe('mapCandidateRow screenUrl', () => {
  it('builds a screenUrl deep-link when gameId/market/selection present', () => {
    const out = mapCandidateRow({
      gameId: 'WNBA:PREMATCH:Las_Vegas_Aces:Phoenix_Mercury:1783807200',
      market: 'Total Points',
      league: 'WNBA',
      selection: 'Under 166.5',
      start: '2026-07-11T22:00:00.000Z'
    });
    assert.equal(
      out.screenUrl,
      'https://app.propprofessor.com/screen?market=Total%20Points' +
        '&game=WNBA%3APREMATCH%3ALas_Vegas_Aces%3APhoenix_Mercury%3A1783807200' +
        '&league=WNBA&participant=Under%20166.5'
    );
  });

  it('returns null screenUrl when required fields are missing', () => {
    const out = mapCandidateRow({ selection: 'Lakers' });
    assert.equal(out.screenUrl, null);
  });
});
