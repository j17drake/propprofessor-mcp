'use strict';

const {
  MARKET_ALIASES,
  _aliasLeagueKey,
  resolveMarketName
} = require('../lib/propprofessor-shared-utils');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ ${message}`);
    failCount++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failCount++;
  }
}

console.log('\n=== MARKET_ALIASES tests ===');

// Test MARKET_ALIASES structure exists
assert(MARKET_ALIASES !== undefined && typeof MARKET_ALIASES === 'object', 'MARKET_ALIASES is defined');
assert(MARKET_ALIASES.total !== undefined && typeof MARKET_ALIASES.total === 'object', 'MARKET_ALIASES.total exists');
assert(MARKET_ALIASES.spread !== undefined && typeof MARKET_ALIASES.spread === 'object', 'MARKET_ALIASES.spread exists');
assert(MARKET_ALIASES.puck_line !== undefined, 'MARKET_ALIASES.puck_line exists');
assert(MARKET_ALIASES.run_line !== undefined, 'MARKET_ALIASES.run_line exists');
assert(MARKET_ALIASES.total_goals !== undefined, 'MARKET_ALIASES.total_goals exists');
assert(MARKET_ALIASES.total_runs !== undefined, 'MARKET_ALIASES.total_runs exists');
assert(MARKET_ALIASES.total_points !== undefined, 'MARKET_ALIASES.total_points exists');

console.log('\n=== resolveMarketName tests ===');

// Total aliases
assertEqual(
  resolveMarketName('Total', 'NHL'),
  { resolved: 'Total Goals', wasAliased: true, original: 'Total', aliasKey: 'total' },
  '"Total" + NHL -> "Total Goals"'
);

assertEqual(
  resolveMarketName('Total', 'MLB'),
  { resolved: 'Total Runs', wasAliased: true, original: 'Total', aliasKey: 'total' },
  '"Total" + MLB -> "Total Runs"'
);

assertEqual(
  resolveMarketName('Total', 'NBA'),
  { resolved: 'Total Points', wasAliased: true, original: 'Total', aliasKey: 'total' },
  '"Total" + NBA -> "Total Points"'
);

assertEqual(
  resolveMarketName('Total', 'WNBA'),
  { resolved: 'Total Points', wasAliased: true, original: 'Total', aliasKey: 'total' },
  '"Total" + WNBA -> "Total Points"'
);

assertEqual(
  resolveMarketName('Total', 'SOCCER'),
  { resolved: 'Total Goals', wasAliased: true, original: 'Total', aliasKey: 'total' },
  '"Total" + SOCCER -> "Total Goals"'
);

// Spread aliases
assertEqual(
  resolveMarketName('Spread', 'NHL'),
  { resolved: 'Puck Line', wasAliased: true, original: 'Spread', aliasKey: 'spread' },
  '"Spread" + NHL -> "Puck Line"'
);

assertEqual(
  resolveMarketName('Spread', 'MLB'),
  { resolved: 'Run Line', wasAliased: true, original: 'Spread', aliasKey: 'spread' },
  '"Spread" + MLB -> "Run Line"'
);

assertEqual(
  resolveMarketName('Spread', 'NBA'),
  { resolved: 'Spread', wasAliased: true, original: 'Spread', aliasKey: 'spread' },
  '"Spread" + NBA -> "Spread" (passthrough)'
);

// Case insensitivity and whitespace handling
assertEqual(
  resolveMarketName('  total  ', 'NHL'),
  { resolved: 'Total Goals', wasAliased: true, original: 'total', aliasKey: 'total' },
  'whitespace trimmed + Total -> "Total Goals"'
);

assertEqual(
  resolveMarketName('TOTAL', 'NHL'),
  { resolved: 'Total Goals', wasAliased: true, original: 'TOTAL', aliasKey: 'total' },
  'uppercase TOTAL -> "Total Goals"'
);

// Shorthand aliases
assertEqual(
  resolveMarketName('rl', 'MLB'),
  { resolved: 'Run Line', wasAliased: true, original: 'rl', aliasKey: 'rl' },
  '"rl" + MLB -> "Run Line"'
);

assertEqual(
  resolveMarketName('pl', 'NHL'),
  { resolved: 'Puck Line', wasAliased: true, original: 'pl', aliasKey: 'pl' },
  '"pl" + NHL -> "Puck Line"'
);

assertEqual(
  resolveMarketName('run line', 'MLB'),
  { resolved: 'Run Line', wasAliased: true, original: 'run line', aliasKey: 'run_line' },
  '"run line" + MLB -> "Run Line"'
);

// No alias - passthrough
assertEqual(
  resolveMarketName('Moneyline', 'NBA'),
  { resolved: 'Moneyline', wasAliased: false, original: 'Moneyline', aliasKey: null },
  '"Moneyline" + NBA -> "Moneyline" (passthrough)'
);

// Canonical name that has a matching alias entry (e.g. "puck_line" alias maps to "Puck Line")
// wasAliased is true because the alias was recognized, even though the resolved value matches input
assertEqual(
  resolveMarketName('Puck Line', 'NHL'),
  { resolved: 'Puck Line', wasAliased: true, original: 'Puck Line', aliasKey: 'puck_line' },
  '"Puck Line" + NHL -> "Puck Line" (alias recognized, resolved same)'
);

// Empty/undefined -> default Moneyline
assertEqual(
  resolveMarketName(undefined, 'NBA'),
  { resolved: 'Moneyline', wasAliased: false, original: '', aliasKey: null },
  'undefined + NBA -> "Moneyline" (default)'
);

assertEqual(
  resolveMarketName('', 'NHL'),
  { resolved: 'Moneyline', wasAliased: false, original: '', aliasKey: null },
  'empty string + NHL -> "Moneyline" (default)'
);

// Unknown market -> passthrough
assertEqual(
  resolveMarketName('Unknown Market', 'NBA'),
  { resolved: 'Unknown Market', wasAliased: false, original: 'Unknown Market', aliasKey: null },
  'unknown market -> passthrough'
);

// Specific canonical names that have alias entries (wasAliased=true because alias was recognized)
assertEqual(
  resolveMarketName('Total Goals', 'NHL'),
  { resolved: 'Total Goals', wasAliased: true, original: 'Total Goals', aliasKey: 'total_goals' },
  '"Total Goals" + NHL -> "Total Goals" (alias recognized)'
);

assertEqual(
  resolveMarketName('Total Points', 'NBA'),
  { resolved: 'Total Points', wasAliased: true, original: 'Total Points', aliasKey: 'total_points' },
  '"Total Points" + NBA -> "Total Points" (alias recognized)'
);

console.log('\n=== Summary ===');
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}