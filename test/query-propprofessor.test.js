'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { main } = require('../scripts/query-propprofessor');

describe('query-propprofessor tennis command', () => {
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
});
