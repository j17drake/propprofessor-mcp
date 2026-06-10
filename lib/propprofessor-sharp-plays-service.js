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

/**
 * Orchestrate a multi-league/multi-market sharp-play scan across one or more target books.
 *
 * For each (targetBook, league, market) combination the function queries either
 * `queryLeagueScreen` or `queryTennisScreen` (depending on the league's ranking preset).
 * It then cross-references the returned rows against a set of sharp comparison books to
 * tag rows that show supportive sharp-book movement. Finally it summarises & shortlists
 * the results via `summarizeSharpPlayRows` and optionally builds a UFC shortlist.
 *
 * @param {Object}  [args={}] - Configuration object.
 * @param {string|string[]} [args.book] - Single target execution book (alias for `targetBook`).
 * @param {string}  [args.targetBook] - Alias for `book`.
 * @param {string[]} [args.targetBooks] - Execution books to scan together.
 * @param {string[]} [args.sharpBooks] - Override the default sharp-book comparison set.
 * @param {string|string[]} [args.league] - Single league shortcut.
 * @param {string[]} [args.leagues] - Leagues to scan (default: NBA, MLB, NHL, Tennis, WNBA).
 * @param {string}   [args.market] - Single market shortcut.
 * @param {string[]} [args.markets] - Markets to scan (default: ["Moneyline"]).
 * @param {number}   [args.limit] - Max final sharp plays to return.
 * @param {number}   [args.scanLimit] - Per-league/market ranked rows to scan before final filtering.
 * @param {boolean}  [args.strict=true] - When true, returns only Bet candidates.
 * @param {boolean}  [args.includePasses] - Include failed rows with passReasons for debugging.
 * @param {boolean}  [args.requirePlayablePrice] - When true, rows without a playable price are excluded.
 * @param {boolean}  [args.requireBestPrice] - When true, only rows where the target book has the best price are kept.
 * @param {number}   [args.minConsensusBookCount] - Minimum number of books with data for prop classification.
 * @param {number}   [args.minOdds] - Minimum target-book American odds.
 * @param {number}   [args.maxOdds] - Maximum target-book American odds.
 * @param {number}   [args.lookbackHours] - Odds-history lookback window in hours.
 * @param {boolean}  [args.is_live] - Whether to query live odds.
 * @param {boolean}  [args.debug] - Include verbose movement debug payloads.
 * @param {Object}   [deps={}] - Dependency injection object.
 * @param {Function} deps.queryLeagueScreen - Async function called with `(args, league)` to screen a league.
 * @param {Function} deps.queryTennisScreen - Async function called with `(args)` to screen tennis.
 *
 * @returns {Promise<Object>} Result object.
 * @returns {boolean}  result.ok - Always `true`.
 * @returns {number}   result.count - Number of final sharp plays returned.
 * @returns {Object[]} result.result - Array of filtered & tagged play rows.
 * @returns {Object}   result.resultMeta - Metadata about the scan.
 * @returns {string}   result.resultMeta.source - Always `'sharp_plays_addon'`.
 * @returns {string}   result.resultMeta.targetBook - The primary target book.
 * @returns {string[]} result.resultMeta.targetBooks - All target books scanned.
 * @returns {number}   result.resultMeta.targetBookCount - How many target books.
 * @returns {string[]} result.resultMeta.leagues - Leagues that were scanned.
 * @returns {string[]} result.resultMeta.markets - Markets that were scanned.
 * @returns {boolean}  result.resultMeta.strict - Whether strict mode was in effect.
 * @returns {boolean}  result.resultMeta.includePasses - Whether pass rows are included.
 * @returns {number}   result.resultMeta.minConsensusBookCount - Minimum book count used.
 * @returns {number|null} result.resultMeta.minOdds - Minimum odds filter applied.
 * @returns {number|null} result.resultMeta.maxOdds - Maximum odds filter applied.
 * @returns {number}   result.resultMeta.lookbackHoursUsed - Lookback window actually used.
 * @returns {number}   result.resultMeta.scannedRowCount - Total rows scanned across all queries.
 * @returns {number}   result.resultMeta.scannedQueryCount - Total screen queries issued.
 * @returns {Object}   result.resultMeta.perTargetBook - Per-book scanning/returned counts.
 * @returns {Object}   result.resultMeta.classificationSummary - Classification breakdown from `summarizeSharpPlayRows`.
 * @returns {Object|null} result.resultMeta.emptyState - When result is empty, describes why.
 * @returns {Object|null} result.resultMeta.ufcShortlist - UFC-specific shortlist, or `null`.
 * @returns {string}   result.resultMeta.workflow - Description of the scanning methodology.
 */
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
          limit:
            Number.isFinite(Number(args.scanLimit)) && Number(args.scanLimit) > 0
              ? Number(args.scanLimit)
              : Math.max(20, getLimit(args) * 3)
        };
        const response =
          String(getLeagueRankingPreset(league).league || league).toUpperCase() === 'TENNIS'
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
            fields: [
              'gameId',
              'game',
              'selection',
              'participant',
              'pick',
              'movementLabel',
              'movementSourceBook',
              'clvProxyPct'
            ]
          };
          const sharpResponse =
            String(getLeagueRankingPreset(league).league || league).toUpperCase() === 'TENNIS'
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
        } catch (err) {
          // Sharp book query failed — continue without it
          if (process.env.PROPPROFESSOR_DEBUG) {
            process.stderr.write(`[sharp-plays] query failed for ${book}: ${err.message}\n`);
          }
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
  const ufcRows = rankedRows.filter(
    (row) =>
      String(row.scanLeague || row.league || '')
        .trim()
        .toUpperCase() === 'UFC'
  );
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
  const emptyState =
    result.length === 0
      ? {
          reason:
            sharpPlaySummary.classificationSummary.totalRowsClassified === 0
              ? 'no_ranked_rows_scanned'
              : 'rows_failed_post_filter',
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
      minConsensusBookCount: Number.isFinite(Number(args.minConsensusBookCount))
        ? Number(args.minConsensusBookCount)
        : 2,
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
