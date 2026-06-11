const test = require('node:test');
const assert = require('node:assert');

test('backtest-daily-snapshot exports SUPPORTED_LEAGUES with expected leagues', () => {
  const mod = require('../scripts/backtest-daily-snapshot.js');
  assert.ok(mod.SUPPORTED_LEAGUES, 'should export SUPPORTED_LEAGUES');
  assert.ok(mod.SUPPORTED_LEAGUES instanceof Set, 'should be a Set');
  // Sanity: real leagues present
  ['NBA', 'MLB', 'NHL', 'NFL', 'WNBA', 'UFC', 'TENNIS', 'SOCCER', 'NCAAB', 'NCAAF'].forEach((league) => {
    assert.ok(mod.SUPPORTED_LEAGUES.has(league), `should include ${league}`);
  });
  // Sanity: garbage league rejected
  assert.ok(!mod.SUPPORTED_LEAGUES.has('NONEXISTENT_LEAGUE_999'), 'should not include garbage league');
  assert.ok(!mod.SUPPORTED_LEAGUES.has(''), 'should not include empty string');
  assert.ok(!mod.SUPPORTED_LEAGUES.has('nba'), 'should be case-sensitive (nba lowercase not in set)');
});
