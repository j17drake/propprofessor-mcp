'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { main } = require('../scripts/query-propprofessor');

describe('query-propprofessor tennis command', () => {
  it('supports a tennis ranking command that uses the sharper screen helper', async () => {
    const logs = [];
    const calls = [];
    const client = {
      queryScreenOdds: async filters => {
        calls.push(filters);
        return {
          game_data: [
            {
              league: 'Tennis',
              book: 'NoVigApp',
              participant: 'Player A',
              market: 'Moneyline',
              value: 4.2,
              odds: 110,
              lineHistory: [
                { book: 'Pinnacle', odds: 130, time: Date.now() - 5 * 60 * 60 * 1000 },
                { book: 'Pinnacle', odds: 110, time: Date.now() - 60 * 60 * 1000 }
              ],
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
        };
      },
      queryScreenOddsBestComps: async () => {
        throw new Error('should not use best comps when queryScreenOdds is available');
      }
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

    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'Tennis');
    assert.equal(calls[0].market, 'Moneyline');
    assert.equal(logs.length, 1);
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'tennis');
    assert.ok(Array.isArray(output.sample));
    assert.ok(output.sample.length > 0);
    assert.ok(output.sample[0].rankingReason);
    assert.equal(output.sample[0].hasConsensus, true);
    assert.equal(output.sample[0].movementMode, 'same_book');
    assert.equal(Array.isArray(output.sample[0].historySportsbooksRequested), true);
    assert.ok(output.freshness);
  });

  it('supports the generic screen command with nested /screen rows', async () => {
    const logs = [];
    const calls = [];
    const client = {
      queryScreenOddsBestComps: async filters => {
        calls.push(filters);
        return {
          game_data: [
            {
              league: 'NBA',
              market: 'Moneyline',
              homeTeam: 'Boston Celtics',
              awayTeam: 'Miami Heat',
              start: '2026-04-27T23:07:00',
              selections: {
                a: {
                  selection1: 'Boston Celtics',
                  participant1: 'Boston Celtics',
                  selection1Id: 'Moneyline:Boston_Celtics',
                  selection2: 'Miami Heat',
                  participant2: 'Miami Heat',
                  selection2Id: 'Moneyline:Miami_Heat',
                  odds: {
                    NoVigApp: { odds1: -150, odds2: 130 },
                    Polymarket: { odds1: -148, odds2: 128 }
                  }
                }
              }
            }
          ]
        };
      }
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      await main({
        argv: ['node', 'query-propprofessor.js', 'screen', '--league', 'NBA', '--market', 'Moneyline'],
        client,
        logger: { log: msg => logs.push(msg), error: msg => logs.push(msg) }
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].league, 'NBA');
    assert.equal(logs.length, 1);
    const output = JSON.parse(logs[0]);
    assert.equal(output.command, 'screen');
    assert.ok(Array.isArray(output.sample));
    assert.ok(output.sample.some(row => row.selectionId === 'Moneyline:Boston_Celtics'));
    assert.equal(output.sample[0].startLocal, 'Apr 27, 2026, 6:07 PM CDT');
    assert.equal(output.notes.timeInterpretation, 'start values without an explicit timezone are treated as UTC, displayed in America/Chicago');
  });

  it('rejects the removed fantasy command so the CLI stays screen-only', async () => {
    await assert.rejects(
      () => main({
        argv: ['node', 'query-propprofessor.js', 'fantasy'],
        client: {},
        logger: { log() {}, error() {} }
      }),
      /screen-only|Unknown command: fantasy/
    );
  });
});
