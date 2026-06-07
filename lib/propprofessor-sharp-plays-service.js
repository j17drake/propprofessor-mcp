'use strict';

const { getSharpBookComparisonSet } = require('./propprofessor-sharp-books');
const {
  buildUfcShortlist,
  resolveSharpPlayLeagues,
  resolveSharpPlayMarkets,
  resolveTargetBooks,
  summarizeSharpPlayRows,
  uniqueBooks
} = require('./propprofessor-sharp-plays');
const { getLeagueRankingPreset, getLimit, getLookbackHours } = require('./propprofessor-mcp-ranked-screen');

async function runSharpPlays(args = {}, { queryLeagueScreen, queryTennisScreen } = {}) {
  if (typeof queryLeagueScreen !== 'function') {
    throw new TypeError('runSharpPlays requires queryLeagueScreen(args, league)');
  }
  if (typeof queryTennisScreen !== 'function') {
    throw new TypeError('runSharpPlays requires queryTennisScreen(args)');
  }

  const targetBooks = resolveTargetBooks(args);
  const targetBook = targetBooks[0];
  const leagues = resolveSharpPlayLeagues(args);
  const markets = resolveSharpPlayMarkets(args);
  const targetPlusSharpBooks = (league, market, executionBook) =>
    uniqueBooks([
      executionBook,
      ...getSharpBookComparisonSet({
        league,
        market,
        requestedBooks: Array.isArray(args.sharpBooks) && args.sharpBooks.length ? args.sharpBooks : undefined
      })
    ]);
  const rankedResponses = [];
  let sharpBookQueryCount = 0;

  for (const executionBook of targetBooks) {
    for (const league of leagues) {
      for (const market of markets) {
        const books = targetPlusSharpBooks(league, market, executionBook);
        const rankedArgs = {
          ...args,
          league,
          market,
          book: executionBook,
          targetBook: executionBook,
          books,
          historySportsbooks: books,
          includeAll: true,
          limit: Number.isFinite(Number(args.scanLimit)) && Number(args.scanLimit) > 0 ? Number(args.scanLimit) : Math.max(20, getLimit(args) * 3)
        };
        const response = String(getLeagueRankingPreset(league).league || league).toUpperCase() === 'TENNIS'
          ? await queryTennisScreen(rankedArgs)
          : await queryLeagueScreen(rankedArgs, getLeagueRankingPreset(league).league || league);
        rankedResponses.push({ targetBook: executionBook, league, market, response });
      }
    }
  }

  const rankedRows = rankedResponses.flatMap(({ targetBook: executionBook, league, market, response }) =>
    (Array.isArray(response?.result) ? response.result : []).map((row) => ({
      ...row,
      targetBook: executionBook,
      executionBook,
      scanTargetBook: executionBook,
      scanLeague: league,
      scanMarket: market
    }))
  );

  // Sharp book cross-reference: query all sharp books together so that
  // history hydration and movement analysis actually work. Querying each
  // book individually (books: [sharpBook]) means no consensus data and
  // movementLabel always comes back as 'insufficient_history'.
  const sharpBookComparisonSet = getSharpBookComparisonSet({
    league: leagues[0],
    market: markets[0],
    requestedBooks: Array.isArray(args.sharpBooks) && args.sharpBooks.length ? args.sharpBooks : undefined
  });
  const sharpBookMovementMap = new Map(); // key: "gameId|selection" → { book, movementLabel, clvProxyPct }
  // Filter out target books from the sharp set
  const crossRefSharpBooks = sharpBookComparisonSet.filter(
    (sb) => !targetBooks.some((tb) => tb.toLowerCase() === sb.toLowerCase())
  );
  if (crossRefSharpBooks.length > 0) {
    for (const league of leagues) {
      for (const market of markets) {
        try {
          const sharpArgs = {
            ...args,
            league,
            market,
            books: crossRefSharpBooks,
            historySportsbooks: crossRefSharpBooks,
            includeAll: true,
            limit: 50,
            compact: true,
            fields: ['gameId', 'game', 'selection', 'participant', 'pick', 'movementLabel', 'movementSourceBook', 'clvProxyPct']
          };
          const sharpResponse = String(getLeagueRankingPreset(league).league || league).toUpperCase() === 'TENNIS'
            ? await queryTennisScreen(sharpArgs)
            : await queryLeagueScreen(sharpArgs, getLeagueRankingPreset(league).league || league);
          sharpBookQueryCount++;
          for (const row of Array.isArray(sharpResponse?.result) ? sharpResponse.result : []) {
            const gameId = String(row.gameId || row.game || '').trim();
            const selection = String(row.selection || row.participant || row.pick || '').trim();
            if (!gameId || !selection) continue;
            const key = `${gameId}|${selection}`;
            if (row.movementLabel === 'supportive' && !sharpBookMovementMap.has(key)) {
              sharpBookMovementMap.set(key, {
                book: row.book || crossRefSharpBooks[0],
                movementLabel: row.movementLabel,
                clvProxyPct: row.clvProxyPct ?? null
              });
            }
          }
        } catch {
          // Sharp book query failed — continue without it
        }
      }
    }
  }

  // Tag ranked rows with sharp book movement confirmation
  for (const row of rankedRows) {
    const gameId = String(row.gameId || row.game || '').trim();
    const selection = String(row.selection || row.participant || row.pick || '').trim();
    if (!gameId || !selection) continue;
    const key = `${gameId}|${selection}`;
    const sharpMovement = sharpBookMovementMap.get(key);
    if (sharpMovement) {
      row.sharpBookMovementConfirmed = true;
      row.sharpBookMovementSource = sharpMovement.book;
      row.sharpBookClv = sharpMovement.clvProxyPct;
    }
  }
  const strict = args.strict !== undefined ? Boolean(args.strict) : true;
  const sharpPlaySummary = summarizeSharpPlayRows(rankedRows, {
    ...args,
    targetBook,
    strict,
    limit: getLimit(args),
    requirePlayablePrice: args.requirePlayablePrice !== undefined ? args.requirePlayablePrice : false,
    requireBestPrice: args.requireBestPrice !== undefined ? args.requireBestPrice : false
  });
  const result = sharpPlaySummary.filteredRows;
  const ufcRows = rankedRows.filter((row) => String(row.scanLeague || row.league || '').trim().toUpperCase() === 'UFC');
  const ufcShortlist = ufcRows.length
    ? buildUfcShortlist(ufcRows, {
        ...args,
        targetBook,
        limit: getLimit(args)
      })
    : null;
  const perTargetBook = Object.fromEntries(
    targetBooks.map((book) => {
      const scanned = rankedRows.filter((row) => row.executionBook === book).length;
      const returned = result.filter((row) => (row.executionBook || row.targetBook || row.book) === book).length;
      return [book, { scanned, returned }];
    })
  );
  const emptyState = result.length === 0
    ? {
        reason: sharpPlaySummary.classificationSummary.totalRowsClassified === 0 ? 'no_ranked_rows_scanned' : 'rows_failed_post_filter',
        scannedRowCount: sharpPlaySummary.classificationSummary.totalRowsClassified,
        failureBreakdown: sharpPlaySummary.classificationSummary.passReasonCounts,
        topNearMisses: sharpPlaySummary.topNearMisses
      }
    : null;

  return {
    ok: true,
    count: result.length,
    result,
    resultMeta: {
      source: 'sharp_plays_addon',
      targetBook,
      targetBooks,
      targetBookCount: targetBooks.length,
      leagues,
      markets,
      strict,
      includePasses: Boolean(args.includePasses),
      minConsensusBookCount: Number.isFinite(Number(args.minConsensusBookCount)) ? Number(args.minConsensusBookCount) : 2,
      minOdds: args.minOdds ?? null,
      maxOdds: args.maxOdds ?? null,
      lookbackHoursUsed: getLookbackHours(args),
      scannedRowCount: rankedRows.length,
      scannedQueryCount: rankedResponses.length + sharpBookQueryCount,
      perTargetBook,
      classificationSummary: sharpPlaySummary.classificationSummary,
      emptyState,
      ufcShortlist,
      workflow:
        'Target book is execution only. Supportive movement must come from a non-target sharp book; target-book-only movement is downgraded. For props, market availability and playable price are used instead of raw consensus count.'
    }
  };
}

module.exports = {
  runSharpPlays
};
