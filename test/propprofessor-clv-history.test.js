'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseCsvLine,
  americanToImpliedProb,
  computeClvPercent,
  computeProfit,
  getClvHistory,
  readBetLog,
  groupBets,
  DEFAULT_BET_LOG_PATH
} = require('../lib/propprofessor-clv-history');

function tmpLogPath() {
  return path.join(os.tmpdir(), `bet-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
}

describe('parseCsvLine', () => {
  it('parses simple comma-separated fields', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });

  it('handles empty fields', () => {
    assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']);
  });

  it('handles quoted fields with commas', () => {
    assert.deepEqual(parseCsvLine('"a,b",c'), ['a,b', 'c']);
  });

  it('handles escaped quotes inside quoted fields', () => {
    assert.deepEqual(parseCsvLine('"a""b",c'), ['a"b', 'c']);
  });
});

describe('americanToImpliedProb', () => {
  it('converts positive odds correctly', () => {
    assert.equal(americanToImpliedProb(150).toFixed(4), '0.4000');
    assert.equal(americanToImpliedProb(100).toFixed(4), '0.5000');
    assert.equal(americanToImpliedProb(200).toFixed(4), '0.3333');
  });

  it('converts negative odds correctly', () => {
    assert.equal(americanToImpliedProb(-150).toFixed(4), '0.6000');
    assert.equal(americanToImpliedProb(-100).toFixed(4), '0.5000');
    assert.equal(americanToImpliedProb(-200).toFixed(4), '0.6667');
  });

  it('returns NaN for zero or non-finite', () => {
    assert.ok(Number.isNaN(americanToImpliedProb(0)));
    assert.ok(Number.isNaN(americanToImpliedProb(NaN)));
    assert.ok(Number.isNaN(americanToImpliedProb('foo')));
  });
});

describe('computeClvPercent', () => {
  it('returns positive CLV when favorite bets beat the close (less juice at taken)', () => {
    // Took -130, closed at -150 → you got a better price (less juice)
    // Decimal: -130 → 1.769, -150 → 1.667
    // CLV = (1.769 / 1.667 - 1) × 100 = +6.12%
    const clv = computeClvPercent(-130, -150);
    assert.ok(clv > 0, `CLV should be positive when you beat the close (favorite at -130 vs -150), got ${clv.toFixed(2)}`);
    assert.ok(clv > 5 && clv < 7, `expected ~6.12% CLV, got ${clv.toFixed(2)}`);
  });

  it('returns positive CLV when underdog bets beat the close (more payout at taken)', () => {
    // Took +150, closed at +130 → you got a better price (more payout)
    // Decimal: +150 → 2.5, +130 → 2.3
    // CLV = (2.5 / 2.3 - 1) × 100 = +8.70%
    const clv = computeClvPercent(150, 130);
    assert.ok(clv > 0, `CLV should be positive when you beat the close (underdog at +150 vs +130), got ${clv.toFixed(2)}`);
    assert.ok(clv > 8 && clv < 9, `expected ~8.70% CLV, got ${clv.toFixed(2)}`);
  });

  it('returns negative CLV when you take a worse price than the close', () => {
    // Took -150, closed at -130 → you got worse price (more juice at taken)
    // CLV = (1.667 / 1.769 - 1) × 100 = -5.77%
    const clv = computeClvPercent(-150, -130);
    assert.ok(clv < 0, `CLV should be negative when you got a worse price, got ${clv.toFixed(2)}`);
  });

  it('returns zero CLV when taken equals close', () => {
    const clv = computeClvPercent(-110, -110);
    assert.equal(clv, 0);
  });

  it('returns null for non-finite inputs', () => {
    assert.equal(computeClvPercent(NaN, -110), null);
    assert.equal(computeClvPercent(-110, NaN), null);
  });

  it('CLV is positive for losing bet at great odds (CLV is about price quality, not outcome)', () => {
    // Lost an underdog at +180 that closed at +140. Lost the bet, but GREAT CLV.
    // Decimal: +180 → 2.8, +140 → 2.4
    // CLV = (2.8 / 2.4 - 1) × 100 = +16.67%
    const clv = computeClvPercent(180, 140);
    assert.ok(clv > 16, `expected ~16.67% CLV on a losing underdog with great price, got ${clv.toFixed(2)}`);
  });
});

describe('computeProfit', () => {
  it('returns positive profit on win at positive odds', () => {
    assert.equal(computeProfit(150, 100, 'win'), 150);
  });

  it('returns positive profit on win at negative odds', () => {
    assert.equal(computeProfit(-150, 150, 'win'), 100);
  });

  it('returns negative stake on loss', () => {
    assert.equal(computeProfit(-150, 50, 'loss'), -50);
  });

  it('returns 0 on push', () => {
    assert.equal(computeProfit(-110, 50, 'push'), 0);
  });
});

describe('readBetLog', () => {
  it('returns error when file does not exist', () => {
    const result = readBetLog('/nonexistent/path/to/bet-log.csv');
    assert.equal(result.bets.length, 0);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors[0], /not found/);
  });

  it('returns error when file is empty', () => {
    const p = tmpLogPath();
    fs.writeFileSync(p, '');
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 0);
    assert.ok(result.errors.length > 0);
  });

  it('returns error when required columns are missing', () => {
    const p = tmpLogPath();
    fs.writeFileSync(p, 'date,league,market\n2026-06-01,MLB,Moneyline\n');
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 0);
    assert.ok(result.errors[0].includes('Missing required columns'));
  });

  it('parses valid rows and computes CLV + profit', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    const row = `${today},NBA,Moneyline,Lakers,NoVigApp,-130,-150,win,50,TIER 1\n`;
    fs.writeFileSync(p, header + row);
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.bets[0].league, 'NBA');
    assert.equal(result.bets[0].oddsTaken, -130);
    assert.equal(result.bets[0].closingOdds, -150);
    assert.equal(result.bets[0].outcome, 'win');
    assert.equal(result.bets[0].stake, 50);
    // CLV should be positive (you beat the close)
    assert.ok(result.bets[0].clvPercent > 0, `CLV should be positive when you beat the close, got ${result.bets[0].clvPercent}`);
    // Profit: win at -130 odds on $50 stake = $50 * (100/130) = $38.46
    assert.equal(result.bets[0].profit.toFixed(2), '38.46');
  });

  it('records error for invalid outcome and skips row', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    const row = `${today},NBA,Moneyline,Lakers,NoVigApp,-130,-150,unknown,50,TIER 1\n`;
    fs.writeFileSync(p, header + row);
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 0);
    assert.ok(result.errors[0].includes('invalid outcome'));
  });

  it('records error for non-numeric odds and skips row', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    const row = `${today},NBA,Moneyline,Lakers,NoVigApp,abc,-150,win,50,TIER 1\n`;
    fs.writeFileSync(p, header + row);
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 0);
    assert.ok(result.errors[0].includes('invalid odds_taken'));
  });

  it('handles quoted fields with commas in selection name', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    const row = `${today},NBA,Moneyline,"Lakers, LeBron",NoVigApp,-130,-150,win,50,TIER 1\n`;
    fs.writeFileSync(p, header + row);
    const result = readBetLog(p);
    fs.unlinkSync(p);
    assert.equal(result.bets.length, 1);
    assert.equal(result.bets[0].selection, 'Lakers, LeBron');
  });
});

describe('groupBets', () => {
  const sampleBets = [
    { clvPercent: 2.0, outcome: 'win', profit: 100, stake: 50, league: 'NBA', tier: 'TIER 1', book: 'NoVigApp', date: '2026-06-01' },
    { clvPercent: -1.0, outcome: 'loss', profit: -50, stake: 50, league: 'NBA', tier: 'TIER 2', book: 'NoVigApp', date: '2026-06-02' },
    { clvPercent: 3.0, outcome: 'win', profit: 75, stake: 50, league: 'MLB', tier: 'TIER 1', book: 'Pinnacle', date: '2026-06-03' },
    { clvPercent: 1.0, outcome: 'loss', profit: -25, stake: 25, league: 'MLB', tier: 'TIER 2', book: 'Pinnacle', date: '2026-06-04' }
  ];

  it('groups by sport', () => {
    const groups = groupBets(sampleBets, 'sport');
    assert.equal(groups.length, 2);
    const nba = groups.find((g) => g.key === 'NBA');
    const mlb = groups.find((g) => g.key === 'MLB');
    assert.equal(nba.count, 2);
    assert.equal(mlb.count, 2);
    assert.equal(nba.clvMean, 0.5); // (2 + -1) / 2
    assert.equal(mlb.clvMean, 2.0); // (3 + 1) / 2
  });

  it('groups by tier', () => {
    const groups = groupBets(sampleBets, 'tier');
    const t1 = groups.find((g) => g.key === 'TIER 1');
    const t2 = groups.find((g) => g.key === 'TIER 2');
    assert.equal(t1.count, 2);
    assert.equal(t1.clvMean, 2.5); // (2 + 3) / 2
    assert.equal(t2.clvMean, 0); // (-1 + 1) / 2
  });

  it('groups by book', () => {
    const groups = groupBets(sampleBets, 'book');
    assert.equal(groups.length, 2);
  });

  it('groups by week (ISO format)', () => {
    const groups = groupBets(sampleBets, 'week');
    // All dates are in 2026, ISO week depending on calendar
    assert.ok(groups.length >= 1);
    assert.match(groups[0].key, /^\d{4}-W\d{2}$/);
  });

  it('returns profit, totalStake, and roi in group stats', () => {
    const groups = groupBets(sampleBets, 'sport');
    const nba = groups.find((g) => g.key === 'NBA');
    assert.equal(nba.profit, 50); // 100 - 50
    assert.equal(nba.totalStake, 100); // 50 + 50
    assert.equal(nba.roi, 50); // 50/100 * 100
  });
});

describe('getClvHistory', () => {
  it('returns error for invalid groupBy', () => {
    const result = getClvHistory({ groupBy: 'invalid' });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid groupBy/);
  });

  it('returns message when bet log is missing', () => {
    const result = getClvHistory({ path: '/nonexistent/path.csv' });
    assert.equal(result.ok, false);
  });

  it('returns message when no recent bets', () => {
    const p = tmpLogPath();
    // Old bet (100 days ago)
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const row = `${oldDate},NBA,Moneyline,Lakers,NoVigApp,-130,-150,win,50,TIER 1\n`;
    fs.writeFileSync(p, header + row);
    const result = getClvHistory({ days: 30, path: p });
    fs.unlinkSync(p);
    assert.equal(result.ok, true);
    assert.equal(result.totalBets, 0);
    assert.match(result.message, /No bets in the last 30 days/);
  });

  it('aggregates bets from the last N days', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = [
      `${today},NBA,Moneyline,Lakers,NoVigApp,-130,-150,win,50,TIER 1`,
      `${yesterday},MLB,Moneyline,Yankees,NoVigApp,-160,-170,loss,30,TIER 2`,
      `${today},NBA,Moneyline,Celtics,NoVigApp,+150,+130,win,40,TIER 1`
    ].join('\n');
    fs.writeFileSync(p, header + rows + '\n');
    const result = getClvHistory({ days: 30, path: p, groupBy: 'sport' });
    fs.unlinkSync(p);
    assert.equal(result.ok, true);
    assert.equal(result.totalBets, 3);
    assert.ok(result.avgClv > 0, `expected positive avg CLV (you beat the close on multiple), got ${result.avgClv}`);
    assert.equal(result.totalStake, 120);
    assert.equal(result.byGroup.length, 2);
  });

  it('defaults to groupBy=week', () => {
    const p = tmpLogPath();
    const header = 'date,league,market,selection,book,odds_taken,closing_odds,outcome,stake,tier\n';
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(p, header + `${today},NBA,Moneyline,Lakers,NoVigApp,-130,-150,win,50,TIER 1\n`);
    const result = getClvHistory({ days: 30, path: p });
    fs.unlinkSync(p);
    assert.equal(result.ok, true);
    assert.equal(result.groupBy, 'week');
  });
});

describe('DEFAULT_BET_LOG_PATH', () => {
  it('resolves to ~/Documents/bet-log.csv', () => {
    assert.equal(DEFAULT_BET_LOG_PATH, path.join(os.homedir(), 'Documents', 'bet-log.csv'));
  });
});
