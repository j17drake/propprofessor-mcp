'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  inferDefaultLeague,
  inferDefaultMarket,
  inferIntent,
  inferPreferredBook,
  parseNaturalLanguagePropQuery
} = require('../lib/propprofessor-query-parser');

describe('propprofessor query parser', () => {
  it('parses a player prop question with book, line, and side', () => {
    const parsed = parseNaturalLanguagePropQuery('is Fliff James Harden points over 18.5 good');
    assert.equal(parsed.book, 'Fliff');
    assert.equal(parsed.player, 'James Harden');
    assert.equal(parsed.side, 'over');
    assert.equal(parsed.line, 18.5);
    assert.equal(parsed.intent, 'screen');
  });

  it('infers tennis edge searches from simple prompts', () => {
    const parsed = parseNaturalLanguagePropQuery('find Rebet tennis edges');
    assert.equal(parsed.league, 'Tennis');
    assert.equal(parsed.book, 'Rebet');
    assert.equal(parsed.market, 'Moneyline');
    assert.equal(parsed.intent, 'screen');
  });

  it('infers a strikeouts market for MLB prompts', () => {
    const parsed = parseNaturalLanguagePropQuery('best NoVigApp MLB strikeouts');
    assert.equal(parsed.league, 'MLB');
    assert.equal(parsed.book, 'NoVigApp');
    assert.equal(parsed.market, 'Pitcher Strikeouts');
  });

  it('routes fantasy prompts to fantasy intent', () => {
    const parsed = parseNaturalLanguagePropQuery('is Underdog fantasy good today');
    assert.equal(parsed.intent, 'fantasy');
    assert.equal(parsed.book, 'Underdog');
  });

  it('exposes the helper inferencers', () => {
    assert.equal(inferIntent('best props today'), 'screen');
    assert.equal(inferPreferredBook('use Rebet'), 'Rebet');
    assert.equal(inferDefaultLeague('nba player points'), 'NBA');
    assert.equal(inferDefaultMarket('tennis spread', 'Tennis'), 'Spread');
  });
});