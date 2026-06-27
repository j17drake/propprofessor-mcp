'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolate test calibration from real data
const TEST_CALIBRATION_FILE = path.join(os.homedir(), '.propprofessor', 'signal-calibration.json');
const backup = (() => {
  try { return fs.readFileSync(TEST_CALIBRATION_FILE, 'utf8'); } catch { return null; }
})();

// Reload with test-isolated path
const mod = require('../lib/propprofessor-signal-calibration');

// Restore after test
process.on('exit', () => {
  if (backup) {
    fs.mkdirSync(path.dirname(TEST_CALIBRATION_FILE), { recursive: true });
    fs.writeFileSync(TEST_CALIBRATION_FILE, backup, 'utf8');
  } else {
    try { fs.unlinkSync(TEST_CALIBRATION_FILE); } catch {}
  }
});

test('record and retrieve calibration', () => {
  // Clean state
  mod.save({});

  mod.recordResolution({
    status: 'won',
    confidenceTier: 'TIER 1',
    movementGrade: 'green',
    league: 'NBA',
    market: 'Moneyline'
  });

  mod.recordResolution({
    status: 'lost',
    confidenceTier: 'TIER 1',
    movementGrade: 'green',
    league: 'NBA',
    market: 'Moneyline'
  });

  mod.recordResolution({
    status: 'won',
    confidenceTier: 'TIER 4',
    movementGrade: 'red',
    league: 'MLB',
    market: 'Total Runs'
  });

  const cal = mod.getCalibration();
  const key1 = 'TIER 1:green:NBA:Moneyline';
  const key2 = 'TIER 4:red:MLB:Total Runs';

  assert.equal(cal[key1].wins, 1);
  assert.equal(cal[key1].losses, 1);
  assert.equal(cal[key1].total, 2);
  assert.equal(cal[key1].hitRate, '50.0');
  assert.equal(cal[key2].wins, 1);
  assert.equal(cal[key2].losses, 0);
  assert.equal(cal[key2].hitRate, '100.0');
});

test('missing fields use defaults', () => {
  mod.save({});

  mod.recordResolution({
    status: 'won'
    // no tier, no grade, no league, no market
  });

  const cal = mod.getCalibration();
  const key = 'TIER 4:unknown:?:?';
  assert.equal(cal[key].wins, 1);
});

test('push does not count as win or loss', () => {
  mod.save({});

  mod.recordResolution({
    status: 'push',
    confidenceTier: 'TIER 2',
    movementGrade: 'yellow',
    league: 'NFL',
    market: 'Spread'
  });

  const cal = mod.getCalibration();
  const key = 'TIER 2:yellow:NFL:Spread';
  assert.equal(cal[key].pushes, 1);
  assert.equal(cal[key].wins, 0);
  assert.equal(cal[key].losses, 0);
  assert.equal(cal[key].total, 0);
});
