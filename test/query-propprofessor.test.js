'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { main } = require('../scripts/query-propprofessor');

describe('query-propprofessor ranking commands', () => {
  it('supports a tennis ranking command that uses the sharper screen helper', async () => {
    const logs = [];
    const client = {
      queryScreenOddsBestComps: async () => ({
        game_data: [
          {
            league: 'Tennis',
            book: 'NoVigApp',
            participant: 'Player A',
            market: 'Moneyline',
            value: 4.2,
            odds: 110,
            lineHistory: [130, 110],
            oddsHistory: [130, 110],
            selections: {
              a: {
                selection1: 'Player A',
                selection2: 'Player B',
                odds: {
                  NoVigApp: { odds1: 110, odds2: -120 },
                  Polymarket: { odds1: 108, odds2: -118 },
                  Kalshi: { odds1: 105, odds2: -115 },
                  BetOnline: { odds1: 107, odds2: -117 },
                  Circa: { odds1: 106, odds2: -116 }
                }
              }
            },
            defaultKey: 'a'
          }
        ]
      })
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'tennis'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(logs.length, 1);
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'tennis');
    assert.ok(Array.isArray(output.sample));
    assert.ok(output.sample.length > 0);
    assert.ok(output.sample[0].rankingReason);
    assert.equal(output.sample[0].hasConsensus, true);
    assert.ok(output.freshness);
  });

  it('supports nba as a shorthand screen command', async () => {
    const logs = [];
    const seen = [];
    const client = {
      queryScreenOddsBestComps: async filters => {
        seen.push(filters);
        return { game_data: [{ league: 'NBA', participant: 'Player A', market: 'Moneyline', odds: 110, value: 3.1 }] };
      }
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'nba'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(seen[0].league, 'NBA');
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'nba');
    assert.ok(Array.isArray(output.sample));
  });

  it('supports soccer as a shorthand screen command', async () => {
    const logs = [];
    const seen = [];
    const client = {
      queryScreenOddsBestComps: async filters => {
        seen.push(filters);
        return { game_data: [{ league: 'SOCCER', participant: 'Player A', market: 'Moneyline', odds: 110, value: 2.1 }] };
      }
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'soccer'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(seen[0].league, 'SOCCER');
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'soccer');
    assert.ok(Array.isArray(output.sample));
  });

  it('supports wnba as a shorthand screen command', async () => {
    const logs = [];
    const seen = [];
    const client = {
      queryScreenOddsBestComps: async filters => {
        seen.push(filters);
        return { game_data: [{ league: 'WNBA', participant: 'Player A', market: 'Moneyline', odds: 110, value: 2.4 }] };
      }
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'wnba'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(seen[0].league, 'WNBA');
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'wnba');
    assert.ok(Array.isArray(output.sample));
  });

  it('supports sport as a generic shorthand screen command', async () => {
    const logs = [];
    const seen = [];
    const client = {
      queryScreenOddsBestComps: async filters => {
        seen.push(filters);
        return {
          game_data: [{
            league: 'WNBA',
            participant: 'Player A',
            market: 'Moneyline',
            odds: 110,
            value: 2.4,
            updatedAt: new Date('2026-05-06T12:00:00.000Z').toISOString()
          }]
        };
      }
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'sport', '--league', 'WNBA'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(seen[0].league, 'WNBA');
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'sport');
    assert.ok(Array.isArray(output.sample));
    assert.ok(output.sample.length > 0);
    assert.ok(output.freshness);
  });

  it('supports list as a command inventory shortcut', async () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'list'],
        client: {},
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'list');
    assert.ok(output.commands.includes('list'));
    assert.ok(output.commands.includes('wnba'));
    assert.ok(output.aliases.sport);
  });

});
