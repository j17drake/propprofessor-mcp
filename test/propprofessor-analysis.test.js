'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { analyzePlayerPropBet } = require('../lib/propprofessor-analysis');
const {
  americanOddsToImpliedProbability,
  extractHistoryTrail,
  extractScreenRows,
  isTennisRow,
  normalizeDirection,
  normalizeMarketName,
  normalizeTennisMarketQuery,
  parseBetPrompt,
  rankScreenRows,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  summarizeFreshness,
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate
} = require('../lib/propprofessor-screen-utils');
const { summarizeSharpMovement } = require('../lib/propprofessor-sharp-history');

describe('normalizeMarketName', () => {
  it('normalizes common prop market names', () => {
    assert.equal(normalizeMarketName('Pts'), 'points');
    assert.equal(normalizeMarketName('Player Points'), 'points');
    assert.equal(normalizeMarketName('Assists'), 'assists');
  });
});

describe('normalizeDirection', () => {
  it('normalizes over/under words and symbols', () => {
    assert.equal(normalizeDirection('o'), 'over');
    assert.equal(normalizeDirection('over'), 'over');
    assert.equal(normalizeDirection('u'), 'under');
    assert.equal(normalizeDirection('under'), 'under');
  });
});

describe('parseBetPrompt', () => {
  it('parses a plain-language player prop query', () => {
    const parsed = parseBetPrompt('Is James Harden o18.5 Points a good bet?');
    assert.equal(parsed.player, 'James Harden');
    assert.equal(parsed.side, 'over');
    assert.equal(parsed.line, 18.5);
    assert.equal(parsed.market, 'points');
  });
});

describe('analyzePlayerPropBet', () => {
  const rows = [
    {
      book: 'FanDuel',
      participant: 'James Harden',
      market: 'Player Points',
      selection: 'James Harden Over 18.5',
      odds: -110,
      ev: 6.2
    },
    {
      book: 'DraftKings',
      participant: 'James Harden',
      market: 'Player Points',
      selection: 'James Harden Under 18.5',
      odds: -108,
      ev: -1.1
    }
  ];

  it('returns a yes verdict for a supported over play', () => {
    const result = analyzePlayerPropBet({
      player: 'James Harden',
      side: 'over',
      line: 18.5,
      market: 'Points'
    }, rows);

    assert.equal(result.verdict, 'yes');
    assert.equal(result.bestMatch.book, 'FanDuel');
    assert.equal(result.bestMatch.ev, 6.2);
  });

  it('returns pass when no row matches the requested market', () => {
    const result = analyzePlayerPropBet({
      player: 'James Harden',
      side: 'over',
      line: 22.5,
      market: 'Rebounds'
    }, rows);

    assert.equal(result.verdict, 'pass');
    assert.equal(result.bestMatch, null);
  });
});

describe('extractScreenRows', () => {
  it('returns rows from the odds screen game_data payload', () => {
    const payload = {
      game_data: [
        { id: 'row-1', league: 'Tennis' },
        { id: 'row-2', league: 'Tennis' }
      ],
      participants: [],
      games: []
    };

    assert.deepEqual(extractScreenRows(payload).map(row => row.id), ['row-1', 'row-2']);
  });

  it('falls back to legacy data/results arrays', () => {
    assert.deepEqual(extractScreenRows({ data: [{ id: 'a' }] }).map(row => row.id), ['a']);
    assert.deepEqual(extractScreenRows({ results: [{ id: 'b' }] }).map(row => row.id), ['b']);
    assert.deepEqual(extractScreenRows([{ id: 'c' }]).map(row => row.id), ['c']);
  });

  it('expands nested odds screen selections into per-book rows', () => {
    const payload = {
      game_data: [{
        gameId: 'game-1',
        league: 'NBA',
        market: 'Point Spread',
        homeTeam: 'Houston Rockets',
        awayTeam: 'Los Angeles Lakers',
        selections: {
          '-2.5': {
            selection1: 'Houston Rockets -2.5',
            participant1: 'Houston Rockets',
            selection1Id: 'Point_Spread:Houston_Rockets_-2.5',
            line1: -2.5,
            selection2: 'Los Angeles Lakers +2.5',
            participant2: 'Los Angeles Lakers',
            selection2Id: 'Point_Spread:Los_Angeles_Lakers_+2.5',
            line2: 2.5,
            odds: {
              OnyxOdds: { odds1: -132, odds2: 110 },
              NoVigApp: { odds1: -128, odds2: 104 }
            }
          }
        }
      }]
    };

    const rows = extractScreenRows(payload, [{ book: 'OnyxOdds' }]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.selectionId), [
      'Point_Spread:Houston_Rockets_-2.5',
      'Point_Spread:Los_Angeles_Lakers_+2.5'
    ]);
    assert.deepEqual(rows.map(row => row.book), ['OnyxOdds', 'OnyxOdds']);
    assert.deepEqual(rows.map(row => row.odds), [-132, 110]);
  });
});

describe('tennis screen ranking helpers', () => {
  it('recognizes tennis rows and extracts history trails', () => {
    const row = {
      league: 'Tennis',
      market: 'Moneyline',
      lineHistory: [{ odds: -120 }, { odds: -105 }],
      currentOdds: -105
    };

    assert.equal(isTennisRow(row), true);
    assert.deepEqual(extractHistoryTrail(row), [-120, -105]);
    assert.equal(americanOddsToImpliedProbability(-120) > americanOddsToImpliedProbability(-105), true);
  });

  it('summarizes same-book movement with explicit quality metadata', () => {
    const summary = summarizeSharpMovement({
      lineHistory: [
        { book: 'Pinnacle', odds: -142, time: 1 },
        { book: 'Pinnacle', odds: -150, time: 2 },
        { book: 'Polymarket', odds: -9900, time: 3 }
      ],
      preferredBook: 'NoVigApp',
      sharpBooks: ['Pinnacle', 'Polymarket', 'Kalshi'],
      options: { recentWindowHours: 6 }
    });

    assert.equal(summary.movementSourceBook, 'Pinnacle');
    assert.equal(summary.movementMode, 'same_book');
    assert.equal(summary.movementQuality, 'high');
    assert.equal(summary.lineHistoryUsable, true);
    assert.equal(summary.droppedHistoryPointCount, 1);
    assert.equal(summary.movementLabel, 'supportive');
  });

  it('derives consensus edge from nested /screen odds rows with a preferred book', () => {
    const rows = [
      {
        league: 'Tennis',
        market: 'Game Handicap',
        homeTeam: 'Lajovic',
        awayTeam: 'Sonego',
        defaultKey: 'null',
        selections: {
          null: {
            selection1: 'Lajovic -1.5',
            selection2: 'Sonego +1.5',
            odds: {
              Fliff: { odds1: -120, odds2: 105 },
              Polymarket: { odds1: -126, odds2: 110 },
              Kalshi: { odds1: -124, odds2: 108 },
              BetOnline: { odds1: -122, odds2: 107 },
              Circa: { odds1: -121, odds2: 106 }
            }
          }
        }
      }
    ];

    const ranked = rankTennisScreenRows(rows, { limit: 5, preferredBook: 'Fliff', includeAll: true });
    assert.equal(ranked.length >= 1, true);
    assert.equal(['Lajovic -1.5', 'Sonego +1.5'].includes(ranked[0].participant), true);
    assert.equal(ranked[0].book, 'Fliff');
    assert.equal(ranked[0].consensusEdge !== 0, true);
  });

  it('does not re-expand already extracted tennis rows and preserves the correct preferred-book sides', () => {
    const payload = {
      game_data: [
        {
          league: 'Tennis',
          market: 'Moneyline',
          homeTeam: 'Cobolli',
          awayTeam: 'Medvedev',
          gameId: 'g1',
          selections: {
            a: {
              selection1: 'Cobolli',
              participant1: 'Cobolli',
              selection1Id: 'Moneyline:Cobolli',
              selection2: 'Medvedev',
              participant2: 'Medvedev',
              selection2Id: 'Moneyline:Medvedev',
              odds: {
                NoVigApp: { odds1: 115, odds2: -125 },
                Polymarket: { odds1: 110, odds2: -130 },
                Kalshi: { odds1: 108, odds2: -132 },
                BetOnline: { odds1: 109, odds2: -131 },
                Circa: { odds1: 107, odds2: -133 }
              }
            }
          }
        }
      ]
    };

    const extracted = extractScreenRows(payload);
    const ranked = rankTennisScreenRows(extracted, { limit: 10, preferredBook: 'NoVigApp', includeAll: true });

    assert.equal(ranked.length, 2);
    assert.deepEqual(ranked.map(row => row.book), ['NoVigApp', 'NoVigApp']);
    assert.deepEqual(ranked.map(row => row.participant).sort(), ['Cobolli', 'Medvedev']);
    assert.deepEqual(ranked.map(row => row.selectionId).sort(), ['Moneyline:Cobolli', 'Moneyline:Medvedev']);
    assert.equal(ranked.every(row => row.hasConsensus), true);
    assert.equal(ranked.every(row => row.consensusBookCount === 4), true);
  });

  it('ranks general screen rows with consensus and movement metadata', () => {
    const nowMs = Date.now();
    const rows = [
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'NoVigApp',
        value: 2.1,
        odds: -110,
        lineHistory: [
          { book: 'NoVigApp', odds: -100, time: nowMs - 4 * 60 * 60 * 1000 },
          { book: 'NoVigApp', odds: -105, time: nowMs - 2 * 60 * 60 * 1000 },
          { book: 'NoVigApp', odds: -110, time: nowMs - 30 * 60 * 1000 }
        ]
      },
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'DraftKings',
        value: 0.5,
        odds: 105
      }
    ];

    const ranked = rankScreenRows(rows, { limit: 5, includeAll: true });
    assert.equal(ranked[0].screenScore >= ranked[1].screenScore, true);
    assert.equal(typeof ranked[0].screenMarket, 'string');
    assert.equal(typeof ranked[0].scoreBreakdown.total, 'number');
    assert.equal(ranked[0].lineHistoryUsable, true);
    assert.equal(ranked[0].movementMode, 'same_book');
    assert.equal(ranked[0].movementSourceBook, 'NoVigApp');
    assert.equal(typeof ranked[0].recentClvPct, 'number');
    assert.equal(typeof ranked[0].movementQualityScore, 'number');
  });

  it('filters out weak rows when includeAll is false', () => {
    const ranked = rankScreenRows([
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'NoVigApp',
        odds: -110
      }
    ], { limit: 5, includeAll: false });

    assert.equal(ranked.length, 0);
  });

  it('applies a league ranking preset for NBA, MLB, NFL, NHL, and soccer', () => {
    assert.equal(getLeagueRankingPreset('NBA').displayName, 'NBA');
    assert.equal(getLeagueRankingPreset('MLB').displayName, 'MLB');
    assert.equal(getLeagueRankingPreset('NFL').displayName, 'NFL');
    assert.equal(getLeagueRankingPreset('NHL').displayName, 'NHL');
    assert.equal(getLeagueRankingPreset('soccer').displayName, 'Soccer');
  });

  it('uses market-aware sharp books for NBA, NFL, and MLB presets', () => {
    const nbaMain = getLeagueRankingPreset('NBA', 'Moneyline');
    const nbaProps = getLeagueRankingPreset('NBA', 'Player Points');
    const nflMain = getLeagueRankingPreset('NFL', 'Moneyline');
    const nflProps = getLeagueRankingPreset('NFL', 'Player Passing Yards');
    const mlbMain = getLeagueRankingPreset('MLB', 'Moneyline');
    const mlbProps = getLeagueRankingPreset('MLB', 'Player Strikeouts');
    assert.deepEqual(nbaMain.preferredBooks, ['Circa', 'Pinnacle', 'BookMaker', 'BetOnline', 'DraftKings']);
    assert.deepEqual(nbaProps.preferredBooks, ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle']);
    assert.equal(nbaProps.sharpBookContext.key, 'nba_props');
    assert.deepEqual(nflMain.preferredBooks, ['Circa', 'Pinnacle', 'BookMaker', 'NoVigApp', 'FanDuel']);
    assert.deepEqual(nflProps.preferredBooks, ['Pinnacle', 'FanDuel', 'BookMaker', 'Circa', 'BetOnline']);
    assert.equal(nflProps.sharpBookContext.key, 'nfl_props');
    assert.deepEqual(mlbMain.preferredBooks, ['Pinnacle', 'Circa', 'BookMaker', 'BetOnline', 'DraftKings', 'BetMGM']);
    assert.deepEqual(mlbProps.preferredBooks, ['Circa', 'FanDuel', 'PropBuilder', 'Pinnacle', 'DraftKings', 'Bet365']);
    assert.equal(mlbProps.sharpBookContext.key, 'mlb_props');
  });

  it('scores higher-priority league markets above generic ones', () => {
    const nbaPreset = getLeagueRankingPreset('NBA');
    const pointsScore = getMarketPriorityScore(nbaPreset, 'player points');
    const moneylineScore = getMarketPriorityScore(nbaPreset, 'moneyline');
    assert.equal(pointsScore.weight > moneylineScore.weight, true);
  });

  it('hard-gates weak rows without consensus, movement, or market fit', () => {
    const preset = getLeagueRankingPreset('NBA');
    const gate = passesLeagueRankingGate({
      score: 0.5,
      hasConsensus: false,
      hasLineMovement: false,
      leaguePreset: preset,
      marketHintMatch: null
    });

    assert.equal(gate.passed, false);
    assert.match(gate.reason, /no consensus/);
  });

  it('hard-gates score below the league minimum even when a market fit exists', () => {
    const preset = getLeagueRankingPreset('MLB');
    const gate = passesLeagueRankingGate({
      score: 1.0,
      hasConsensus: false,
      hasLineMovement: true,
      leaguePreset: preset,
      marketHintMatch: 'player strikeouts'
    });

    assert.equal(gate.passed, false);
    assert.match(gate.reason, /below/);
  });

  it('rankLeagueScreenRows carries the league preset into ranked results', () => {
    const ranked = rankLeagueScreenRows([
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'NoVigApp',
        value: 3,
        odds: -105,
        lineHistory: [-115, -105]
      }
    ], { league: 'NBA', includeAll: true });

    assert.equal(ranked[0].leaguePreset, 'NBA');
    assert.equal(ranked[0].screenMarket, 'moneyline');
    assert.equal(ranked[0].scoreBreakdown.sportScore > 0, true);
  });

  it('marks preferred-book-only tennis rows as unranked instead of scoring by book bonus', () => {
    const rows = [
      {
        league: 'Tennis',
        market: 'Moneyline',
        defaultKey: 'null',
        selections: {
          null: {
            selection1: 'Player A',
            selection2: 'Player B',
            odds: {
              Fliff: { odds1: -110, odds2: -110 }
            }
          }
        }
      }
    ];

    const ranked = rankTennisScreenRows(rows, { limit: 2, preferredBook: 'Fliff', includeAll: true });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].hasConsensus, false);
    assert.equal(ranked[0].hasLineMovement, false);
    assert.equal(ranked[0].consensusEdge, null);
    assert.equal(ranked[0].tennisScore, 0);
    assert.equal(ranked[0].scoreBreakdown.sportScore, 0);
    assert.match(ranked[0].rankingReason, /unranked/);
    assert.equal(ranked[0].warning, 'Insufficient comparison data');
    assert.equal(ranked[0].isActionable, false);
    assert.equal(ranked[0].consensusBookCount, 0);
  });

  it('keeps sport fixtures representative for NBA, MLB, NFL, NHL, and soccer', () => {
    const rows = [
      { league: 'NBA', market: 'Player Points', book: 'NoVigApp', value: 2.1, odds: -110 },
      { league: 'MLB', market: 'Player Strikeouts', book: 'NoVigApp', value: 2.2, odds: -105 },
      { league: 'NFL', market: 'Player Passing Yards', book: 'NoVigApp', value: 2.3, odds: -108 },
      { league: 'NHL', market: 'Player Shots', book: 'NoVigApp', value: 2.1, odds: -107 },
      { league: 'SOCCER', market: 'Goal Scorer', book: 'NoVigApp', value: 2.0, odds: 120 }
    ];

    const ranked = [
      rankLeagueScreenRows([rows[0]], { league: 'NBA', includeAll: true })[0],
      rankLeagueScreenRows([rows[1]], { league: 'MLB', includeAll: true })[0],
      rankLeagueScreenRows([rows[2]], { league: 'NFL', includeAll: true })[0],
      rankLeagueScreenRows([rows[3]], { league: 'NHL', includeAll: true })[0],
      rankLeagueScreenRows([rows[4]], { league: 'SOCCER', includeAll: true })[0]
    ];

    assert.deepEqual(ranked.map(row => row.leaguePreset), ['NBA', 'MLB', 'NFL', 'NHL', 'Soccer']);
    assert.equal(ranked.every(row => row.scoreBreakdown.total >= 0), true);
  });

  it('flags rows with stale timestamps when a max age is provided', () => {
    const now = new Date('2026-04-24T13:00:00.000Z').getTime();
    const ranked = rankScreenRows([
      {
        league: 'NBA',
        book: 'NoVigApp',
        market: 'Moneyline',
        value: 2,
        odds: 110,
        updatedAt: new Date(now - 10 * 60 * 1000).toISOString()
      }
    ], { includeAll: true, maxAgeMs: 5 * 60 * 1000 });

    assert.equal(ranked[0].stale, true);
    assert.equal(ranked[0].freshnessMs > 0, true);
    assert.match(ranked[0].rankingReason, /stale data/);
    assert.equal(ranked[0].scoreBreakdown.freshnessPenalty < 0, true);
  });

  it('summarizeFreshness reports timestamp sources and falls back to response age for undated rows', () => {
    const now = new Date('2026-04-24T13:00:00.000Z').getTime();
    const withTimestamps = summarizeFreshness([
      { updatedAt: new Date(now - 10 * 1000).toISOString() },
      { payload: { updatedAt: new Date(now - 30 * 1000).toISOString() } },
      { meta: { timestamp: new Date(now - 20 * 1000).toISOString() } }
    ], now, { maxAgeMs: 15 * 1000 });

    assert.equal(withTimestamps.rowCount, 3);
    assert.equal(withTimestamps.newestAgeMs, 10000);
    assert.equal(withTimestamps.oldestAgeMs, 30000);
    assert.equal(withTimestamps.staleCount, 2);
    assert.equal(withTimestamps.stale, true);
    assert.deepEqual(withTimestamps.timestampSources, {
      updatedAt: 1,
      'payload.updatedAt': 1,
      'meta.timestamp': 1
    });
    assert.equal(withTimestamps.freshnessFallbackUsed, false);

    const fallback = summarizeFreshness([{ league: 'NBA' }, { league: 'NFL' }], now);
    assert.equal(fallback.rowCount, 2);
    assert.equal(fallback.newestAgeMs, 0);
    assert.equal(fallback.oldestAgeMs, 0);
    assert.equal(fallback.freshnessFallbackUsed, true);
    assert.deepEqual(fallback.timestampSources, { response_received: 2 });
  });

  it('exposes richer movement debug metadata on ranked rows', () => {
    const nowMs = Date.now();
    const ranked = rankScreenRows([
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'NoVigApp',
        value: 2.4,
        odds: -112,
        lineHistory: [
          { book: 'NoVigApp', odds: -104, time: nowMs - 5 * 60 * 60 * 1000 },
          { book: 'NoVigApp', odds: -104, time: nowMs - 4 * 60 * 60 * 1000 },
          { book: 'NoVigApp', odds: -112, time: nowMs - 60 * 60 * 1000 },
          { book: 'Polymarket', odds: -9999, time: nowMs - 30 * 60 * 1000 }
        ],
        historySportsbooksRequested: ['NoVigApp', 'Polymarket']
      }
    ], { limit: 5, includeAll: true });

    assert.equal(ranked.length, 1);
    assert.deepEqual(ranked[0].droppedHistoryReasons ?? ranked[0].movementDebug?.droppedHistoryReasons, { duplicate_consecutive: 1, outlier_odds: 1 });
    assert.equal(Array.isArray(ranked[0].filteredLineHistory), true);
    assert.equal(Array.isArray(ranked[0].droppedHistoryPoints), true);
    assert.equal(typeof ranked[0].openToCurrentClvPct, 'number');
    assert.equal(typeof ranked[0].movementDebug, 'object');
    assert.equal(ranked[0].movementDebug.movementMode, ranked[0].movementMode);
    assert.equal(ranked[0].movementDebug.openToCurrentClvPct, ranked[0].openToCurrentClvPct);
    assert.equal(ranked[0].freshnessSource, 'response_received');
    assert.equal(ranked[0].freshnessFallbackUsed, true);
    assert.equal(ranked[0].rankingProvenance.focusBook, 'NoVigApp');
    assert.equal(ranked[0].rankingProvenance.lineHistorySource, null);
    assert.deepEqual(ranked[0].historySportsbooksRequested, ['NoVigApp', 'Polymarket']);
  });

  it('can suppress verbose debug payloads while keeping provenance metadata', () => {
    const ranked = rankScreenRows([
      {
        league: 'NBA',
        market: 'Moneyline',
        book: 'NoVigApp',
        participant: 'Boston Celtics',
        selection: 'Boston Celtics',
        pick: 'Boston Celtics',
        odds: -118,
        currentOdds: -118,
        consensusEdge: 2.4,
        hasConsensus: true,
        consensusBookCount: 2,
        lineHistory: [
          { book: 'NoVigApp', odds: -125, time: Date.now() - 60_000 },
          { book: 'NoVigApp', odds: -118, time: Date.now() }
        ],
        historySportsbooksRequested: ['NoVigApp']
      }
    ], { limit: 5, includeAll: true, debug: false });

    assert.equal(ranked.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(ranked[0], 'movementDebug'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(ranked[0], 'filteredLineHistory'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(ranked[0], 'droppedHistoryReasons'), false);
    assert.ok(ranked[0].rankingProvenance);
    assert.equal(ranked[0].rankingProvenance.focusBook, 'NoVigApp');
  });

  it('maps spread and total market names into tennis screen query groups', () => {
    const { normalizeTennisMarketQuery } = require('../lib/propprofessor-screen-utils');
    assert.deepEqual(normalizeTennisMarketQuery('Spread'), ['Game Handicap', 'Set Handicap', 'Point Spread']);
    assert.deepEqual(normalizeTennisMarketQuery('Total'), ['Total Sets', 'Total Games', 'Over/Under']);
  });
});
