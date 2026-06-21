'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseGameString } = require('../lib/propprofessor-game-context');

describe('parseGameString', () => {
  it('parses "A vs B"', () => {
    const r = parseGameString('Lakers vs Celtics');
    assert.strictEqual(r.team1, 'Lakers');
    assert.strictEqual(r.team2, 'Celtics');
  });

  it('parses "A vs B" with multi-word teams', () => {
    const r = parseGameString('New York Mets vs Philadelphia Phillies');
    assert.strictEqual(r.team1, 'New York Mets');
    assert.strictEqual(r.team2, 'Philadelphia Phillies');
  });

  it('parses with @ separator', () => {
    const r = parseGameString('Celtics @ Lakers');
    assert.strictEqual(r.team1, 'Celtics');
    assert.strictEqual(r.team2, 'Lakers');
  });

  it('parses with at separator', () => {
    const r = parseGameString('Celtics at Lakers');
    assert.strictEqual(r.team1, 'Celtics');
    assert.strictEqual(r.team2, 'Lakers');
  });

  it('returns empty strings for null/undefined', () => {
    const r = parseGameString(null);
    assert.strictEqual(r.team1, '');
    assert.strictEqual(r.team2, '');
  });

  it('returns single team as team1 for no separator', () => {
    const r = parseGameString('Lakers');
    assert.strictEqual(r.team1, 'Lakers');
    assert.strictEqual(r.team2, '');
  });
});

describe('getGameContext', () => {
  it('exports getGameContext', () => {
    const mod = require('../lib/propprofessor-game-context');
    assert.strictEqual(typeof mod.getGameContext, 'function');
  });

  it('returns clean for unsupported sports', async () => {
    const mod = require('../lib/propprofessor-game-context');
    const r = await mod.getGameContext({ sport: 'UFC', selection: 'Islam Makhachev', game: 'Islam Makhachev vs Dustin Poirier' });
    assert.ok(r.riskFlag);
    assert.ok(r.riskSummary);
  });

  it('routes MLB to MLB handler', async () => {
    const mod = require('../lib/propprofessor-game-context');
    const r = await mod.getGameContext({ sport: 'MLB', selection: 'Mets', game: 'Mets vs Phillies' });
    assert.ok(r.ok || r.riskFlag);
  });

  it('routes NBA to basketball handler', async () => {
    const mod = require('../lib/propprofessor-game-context');
    const r = await mod.getGameContext({ sport: 'NBA', selection: 'Lakers', game: 'Lakers vs Celtics', start: new Date().toISOString() });
    assert.ok(typeof r.riskFlag === 'string');
  });

  it('routes Tennis to tennis handler', async () => {
    const mod = require('../lib/propprofessor-game-context');
    const r = await mod.getGameContext({ sport: 'Tennis', selection: 'Djokovic', game: 'Wimbledon' });
    assert.ok(typeof r.riskFlag === 'string');
  });
});
