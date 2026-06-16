'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { expandScreenRow, rankScreenRows } = require('../lib/screen-ranker');

describe('screen-ranker (direct unit tests)', () => {
  describe('expandScreenRow', () => {
    it('expands a row with multi-book odds into a consensus-enriched row', () => {
      const row = {
        book: 'NoVigApp',
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        participant: 'Lakers',
        selection: 'Lakers',
        market: 'Moneyline',
        selection1: 'Lakers',
        participant1: 'Lakers',
        selection1Id: 'Moneyline:Lakers',
        selection2: 'Warriors',
        participant2: 'Warriors',
        selection2Id: 'Moneyline:Warriors',
        allBookOdds: {
          NoVigApp: { book: 'NoVigApp', odds1: -118, odds2: 104 },
          Pinnacle: { book: 'Pinnacle', odds1: -120, odds2: 106 },
          Polymarket: { book: 'Polymarket', odds1: -125, odds2: 110 }
        }
      };
      const [out] = expandScreenRow(row, { preferredBook: 'NoVigApp' });
      assert.equal(out.book, 'NoVigApp');
      assert.equal(out.odds, -118);
      assert.equal(out.consensusBookCount, 2);
    });

    it('drops rows where the preferred book has no price when requirePreferredBook=true', () => {
      // Audit 2026-06-15: regression test for the bug where a row whose
      // allBookOdds only contains Pinnacle/Polymarket/Kalshi was being
      // reported as "Fliff -117" with a non-Fliff book's odds. The fix
      // drops the row entirely when the preferred book is missing.
      const row = {
        book: 'Pinnacle',
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        participant: 'Lakers',
        selection: 'Lakers',
        market: 'Moneyline',
        selection1: 'Lakers',
        participant1: 'Lakers',
        selection1Id: 'Moneyline:Lakers',
        selection2: 'Warriors',
        participant2: 'Warriors',
        selection2Id: 'Moneyline:Warriors',
        allBookOdds: {
          Pinnacle: { book: 'Pinnacle', odds1: -120, odds2: 106 },
          Polymarket: { book: 'Polymarket', odds1: -125, odds2: 110 },
          Kalshi: { book: 'Kalshi', odds1: -118, odds2: 104 }
          // No Fliff in this map — Fliff never posted a price for this match
        }
      };
      const out = expandScreenRow(row, {
        preferredBook: 'Fliff',
        requirePreferredBook: true
      });
      assert.deepEqual(out, [], 'row should be dropped when preferred book is unavailable');
    });

    it('keeps the row when the preferred book is unavailable but requirePreferredBook=false (default)', () => {
      // Without requirePreferredBook, the ranker falls back to the row's
      // source book for the odds. This is the legacy behavior — kept for
      // callers that explicitly want "any book with consensus" rather than
      // "plays on this specific book".
      const row = {
        book: 'Pinnacle',
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        participant: 'Lakers',
        selection: 'Lakers',
        market: 'Moneyline',
        selection1: 'Lakers',
        participant1: 'Lakers',
        selection1Id: 'Moneyline:Lakers',
        selection2: 'Warriors',
        participant2: 'Warriors',
        selection2Id: 'Moneyline:Warriors',
        allBookOdds: {
          Pinnacle: { book: 'Pinnacle', odds1: -120, odds2: 106 },
          Polymarket: { book: 'Polymarket', odds1: -125, odds2: 110 }
        }
      };
      const [out] = expandScreenRow(row, { preferredBook: 'Fliff' });
      assert.ok(out, 'row should be kept when requirePreferredBook is not set');
      assert.equal(out.odds, -120, 'falls back to row source book (Pinnacle) when Fliff unavailable');
    });

    it('reconstructs the lifted-selections shape when row.selections is undefined but allBookOdds is present', () => {
      // v2.1.6 fix: the ranker reconstructs selections: { null: { ..., odds: allBookOdds } }
      // so the main path can find the odds map.
      const row = {
        book: 'NoVigApp',
        homeTeam: 'Lakers',
        awayTeam: 'Warriors',
        participant: 'Lakers',
        selection: 'Lakers',
        market: 'Moneyline',
        selection1: 'Lakers',
        participant1: 'Lakers',
        selection1Id: 'Moneyline:Lakers',
        selection2: 'Warriors',
        participant2: 'Warriors',
        selection2Id: 'Moneyline:Warriors',
        allBookOdds: {
          NoVigApp: { book: 'NoVigApp', odds1: -118, odds2: 104 },
          Pinnacle: { book: 'Pinnacle', odds1: -120, odds2: 106 }
        }
      };
      const [out] = expandScreenRow(row, { preferredBook: 'NoVigApp' });
      assert.equal(out.odds, -118);
      assert.equal(out.consensusBookCount, 1);
    });
  });

  describe('rankScreenRows with requirePreferredBook', () => {
    it('filters out non-preferred rows when requirePreferredBook=true', () => {
      const rows = [
        {
          // Fliff has a price
          book: 'Fliff',
          homeTeam: 'A',
          awayTeam: 'B',
          participant: 'A',
          market: 'Moneyline',
          selection1: 'A',
          participant1: 'A',
          selection1Id: 'Moneyline:A',
          selection2: 'B',
          participant2: 'B',
          selection2Id: 'Moneyline:B',
          allBookOdds: {
            Fliff: { book: 'Fliff', odds1: 100, odds2: -120 },
            Pinnacle: { book: 'Pinnacle', odds1: 102, odds2: -122 }
          }
        },
        {
          // Fliff has NO price — only Pinnacle posted this match
          book: 'Pinnacle',
          homeTeam: 'C',
          awayTeam: 'D',
          participant: 'C',
          market: 'Moneyline',
          selection1: 'C',
          participant1: 'C',
          selection1Id: 'Moneyline:C',
          selection2: 'D',
          participant2: 'D',
          selection2Id: 'Moneyline:D',
          allBookOdds: {
            Pinnacle: { book: 'Pinnacle', odds1: -110, odds2: -110 }
          }
        }
      ];
      const ranked = rankScreenRows(rows, {
        limit: 10,
        preferredBooks: ['Fliff', 'Pinnacle', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
        includeAll: true,
        requirePreferredBook: true
      });
      assert.equal(ranked.length, 1, 'only the row with Fliff price should remain');
      assert.equal(ranked[0].homeTeam, 'A');
      assert.equal(ranked[0].odds, 100);
    });

    it('keeps all rows when requirePreferredBook=false (default)', () => {
      const rows = [
        {
          book: 'Pinnacle',
          homeTeam: 'C',
          awayTeam: 'D',
          participant: 'C',
          market: 'Moneyline',
          selection1: 'C',
          participant1: 'C',
          selection1Id: 'Moneyline:C',
          selection2: 'D',
          participant2: 'D',
          selection2Id: 'Moneyline:D',
          allBookOdds: {
            Pinnacle: { book: 'Pinnacle', odds1: -110, odds2: -110 }
          }
        }
      ];
      const ranked = rankScreenRows(rows, {
        limit: 10,
        preferredBooks: ['Fliff', 'Pinnacle', 'Polymarket'],
        includeAll: true
      });
      assert.equal(ranked.length, 1, 'row should be kept when requirePreferredBook is not set');
    });
  });
});
