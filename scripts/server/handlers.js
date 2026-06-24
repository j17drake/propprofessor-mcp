'use strict';

/**
 * MCP tool handlers (extracted from scripts/propprofessor-mcp-server.js in v2.0.0).
 *
 * This file owns the 23 createMcpHandlers() tool implementations. The
 * createMcpServer() JSON-RPC frame stays in the parent file; this file
 * is a leaf that the parent re-exports for backward compatibility.
 *
 * No behavior change vs. v1.7.0 — this is a pure structural refactor.
 */

const {
  createPropProfessorClient,
  getCookieExpiryInfo,
  isAuthValid,
  resolveAuthFile,
  readAuthState
} = require('../../lib/propprofessor-api');
const {
  getTennisMarketFamily,
  normalizeTennisMarketQuery,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  extractScreenRows,
  enrichTennisEvCandidates
} = require('../../lib/propprofessor-screen-utils');
const {
  resolveMarketName,
  DEFAULT_LEAGUES,
  mapWithConcurrency,
  createCrossCallMemoizedQuery,
  canonicalizeScreenArgs,
  createCanonicalScreenCache
} = require('../../lib/propprofessor-shared-utils');

/**
 * Get default markets for a given league and book.
 * Soccer uses different market names than US sports.
 * @param {string} league - League name (e.g. 'Soccer', 'NBA')
 * @param {string[]} [targetBooks] - Target book names (currently unused, reserved for future per-book overrides)
 * @returns {string[]} Default market names
 */
function getDefaultMarketsForLeague(league, _targetBooks) {
  const leagueUpper = String(league || '')
    .trim()
    .toUpperCase();
  if (leagueUpper === 'SOCCER') {
    return ['Draw No Bet', 'Match Handicap', 'Total Goals'];
  }
  return ['Moneyline', 'Spread', 'Total'];
}
const { getOddsHistoryCache, getOddsHistoryCacheTtlMs } = require('../../lib/mcp-runtime-config');
const { buildUfcShortlist } = require('../../lib/propprofessor-sharp-plays');
const { findBestPrice } = require('../../lib/propprofessor-best-price');
const {
  buildRankedScreenResponse: buildRankedScreenResponseShared,
  getIncludeAll,
  getLeagueRankingPreset,
  getLimit,
  getLookbackHours,
  getMaxAgeMs,
  normalizeBookList,
  normalizeSelectionKey,
  buildCanonicalPlayId,
  getDebugFlag
} = require('../../lib/propprofessor-mcp-ranked-screen');
const {
  getSharpBookComparisonSet,
  getSharpBookContext,
  ALL_SCREEN_BOOKS,
  uniqueBooks
} = require('../../lib/propprofessor-sharp-books');
const { resolveHistoryForEntity } = require('../../lib/propprofessor-history');
const { categorizeError } = require('../../lib/propprofessor-mcp-stdio');
const { computeMovementDisposition } = require('../../lib/propprofessor-movement-disposition');
const { runSharpPlays } = require('../../lib/propprofessor-sharp-plays-service');
const { correctTennisTimes } = require('../../lib/propprofessor-tennis');
const {
  analyzeMultiWindow,
  summarizeResults,
  DEFAULT_WINDOWS,
  DEFAULT_SHARP_BOOKS
} = require('../../lib/propprofessor-sharp-consensus');
const {
  getConfidenceTierStable,
  clearScoreTimeline,
  buildRationale,
  suggestStakes
} = require('../../lib/propprofessor-risk-score');
const { getPlayerContext } = require('../../lib/propprofessor-player-context');
const { getMlbGameContext, findMlbGamePk } = require('../../lib/propprofessor-mlb-game-context');
const { getGameContext } = require('../../lib/propprofessor-game-context');
const { isPlayerSelection } = require('../../lib/propprofessor-selection-type');
const { runResearchOnTopRows } = require('../../lib/propprofessor-research-runner');
const {
  formatRecommendedBetsMinimal,
  formatRecommendedBetsStandard,
  formatSharpPlaysMinimal,
  formatSharpPlaysStandard,
  formatScreenRankedMinimal,
  formatScreenRankedStandard,
  formatGetPlayDetailsMinimal,
  formatGetPlayDetailsStandard
} = require('../../lib/propprofessor-formatter');
const {
  getPickHistory,
  getPickStats,
  logPick,
  readCheckpoint,
  resolvePick,
  writeCheckpoint
} = require('../../lib/propprofessor-picks');
const { parseNaturalLanguagePropQuery } = require('../../lib/propprofessor-query-parser');

// Strip undefined values so they don't override API client defaults via spread
function defined(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// ALL_SCREEN_BOOKS is imported from propprofessor-sharp-books.js

/**
 * Resolve market alias(es) in args using the league context.
 * Returns an object with resolved market(s) and alias info for resultMeta.
 *
 * @param {Object} args - The args object containing market/markets
 * @param {string} league - League name (required for alias lookup)
 * @param {string} [defaultMarket='Moneyline'] - Default market if none provided
 * @returns {{ single: string, array: string[], aliasesUsed: string[] }}
 */
function resolveMarkets(args, league, defaultMarket = 'Moneyline') {
  const leagueKey = league ? String(league).trim().toUpperCase() : '';
  const result = { single: defaultMarket, array: [], aliasesUsed: [] };

  // Resolve single market — only apply aliases when the user doesn't explicitly provide one
  const singleRaw = args.market;
  if (singleRaw !== undefined && singleRaw !== null) {
    // User explicitly provided a market — pass through unchanged (no alias resolution)
    result.single = singleRaw;
  }

  // Resolve markets array — apply aliases for each element
  if (Array.isArray(args.markets) && args.markets.length) {
    result.array = args.markets.map((m) => {
      const resolved = resolveMarketName(m, leagueKey);
      if (resolved.wasAliased) {
        result.aliasesUsed.push(`${m} → ${resolved.resolved}`);
      }
      return resolved.resolved;
    });
  } else if (Array.isArray(args.markets) && args.markets.length === 0) {
    // Empty array stays empty
    result.array = [];
  } else if (singleRaw !== undefined && singleRaw !== null) {
    // No markets array, but single market was provided
    result.array = [result.single];
  }

  // If only markets array provided (no single market), use first element as single
  if ((singleRaw === undefined || singleRaw === null) && result.array.length > 0) {
    result.single = result.array[0];
  }

  return result;
}

// league preset inspector
function buildLeaguePresetSummary() {
  const leagues = ['NBA', 'WNBA', 'MLB', 'NFL', 'NHL', 'UFC', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
  return leagues.map((league) => {
    const preset = getLeagueRankingPreset(league);
    const isSharpLeague = ['NBA', 'NFL', 'MLB'].includes(league);
    const sharpMainMarkets = isSharpLeague ? getSharpBookComparisonSet({ league, market: 'Moneyline' }) : undefined;
    const sharpProps = isSharpLeague
      ? getSharpBookComparisonSet({ league, market: league === 'MLB' ? 'Player Strikeouts' : 'Player Points' })
      : undefined;

    return {
      ...preset,
      sharpMainMarkets,
      sharpProps,
      sharpBookVariants: isSharpLeague
        ? {
            mainMarkets: sharpMainMarkets,
            playerProps: sharpProps
          }
        : undefined,
      sharpBookResearch: getSharpBookContext({ league, market: league === 'MLB' ? 'Moneyline' : undefined })
    };
  });
}

function buildPositiveEvTarget(play = {}) {
  const homeTeam = String(play.homeTeam || '').trim();
  const awayTeam = String(play.awayTeam || '').trim();
  const participant = String(play.participant || play.selection || '').trim();
  const selection = String(play.selection || participant).trim();
  const game = homeTeam && awayTeam ? `${awayTeam} vs ${homeTeam}` : String(play.game || play.matchup || '').trim();
  return {
    book: String(play.book || play.sportsbook || '').trim(),
    playType: String(play.market || play.marketType || '').trim(),
    pick: selection,
    selection,
    participant,
    game,
    odds: play.odds,
    league: String(play.league || '').trim(),
    gameId: play.gameId ?? play.game_id ?? null,
    selectionId: play.selectionId ?? play.selection_id ?? null
  };
}

function createOddsHistoryMemoizedQuery(client) {
  // Cross-call LRU cache (shared process-wide, 5-min TTL). The previous
  // implementation used a per-call Map, which only deduped within a single
  // ev_candidates invocation. The shared cache absorbs "screen_ranked then
  // validate_play" / "validate_play then find_best_price" workflows that
  // re-fetch the same (gameId, selectionId, sportsbooks, startTimestamp).
  // Backed by createCrossCallMemoizedQuery which also provides an in-flight
  // mutex — N concurrent calls for the same key collapse to 1 network call.
  const cache = getOddsHistoryCache();
  const memoized = createCrossCallMemoizedQuery(
    (params) => {
      const sportsbooks = Array.isArray(params.sportsbooks)
        ? params.sportsbooks.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      return client.queryOddsHistory({ ...params, sportsbooks });
    },
    {
      cache,
      keyFn: (params) =>
        JSON.stringify({
          gameId: params.gameId ?? null,
          selectionId: params.selectionId ?? null,
          sportsbooks: Array.isArray(params.sportsbooks)
            ? params.sportsbooks.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          startTimestamp: params.startTimestamp ?? null
        })
    }
  );
  return memoized;
}

async function validatePositiveEvCandidates({ client, candidates = [], args = {} } = {}) {
  const rows = Array.isArray(candidates) ? candidates.filter((play) => play && typeof play === 'object') : [];
  const requestedBooks = normalizeBookList(args.books);
  const limit = getLimit(args);
  const debug = getDebugFlag(args.debug, false);
  const lookbackHoursUsed = getLookbackHours(args);
  const maxAgeMs = getMaxAgeMs(args);
  const queryHistoryMemoized = createOddsHistoryMemoizedQuery(client);
  let failedValidationCount = 0;
  let historyFailureCount = 0;
  const validationWarnings = [];

  const enriched = await mapWithConcurrency(rows, async (play) => {
    const league = String(play.league || args.league || '').trim() || 'NBA';
    const market = String(play.market || args.market || '').trim() || 'Moneyline';
    const focusBook = String(play.book || '').trim();
    const sharpBooks = getSharpBookComparisonSet({
      league,
      market,
      requestedBooks: requestedBooks.length ? requestedBooks : undefined
    });
    const target = buildPositiveEvTarget(play);

    let history;
    let validationFailed = false;
    let validationError = null;
    try {
      history = await resolveHistoryForEntity({
        client,
        target,
        rows,
        lookbackHours: lookbackHoursUsed,
        preferredBook: focusBook || null,
        sharpBooks,
        historySportsbooks: sharpBooks,
        queryHistoryFn: queryHistoryMemoized
      });
    } catch (error) {
      validationFailed = true;
      validationError = error;
      failedValidationCount += 1;
      historyFailureCount += 1;
      history = {
        lineHistory: [],
        lineHistoryAvailable: false,
        lineHistorySource: null,
        historySportsbooksRequested: sharpBooks
      };
    }

    return {
      ...play,
      league,
      market,
      book: focusBook || play.book || play.sportsbook || '',
      participant: play.participant || target.participant,
      selection: play.selection || target.selection,
      pick: play.pick || target.pick,
      game: play.game || play.matchup || target.game,
      odds: play.odds,
      lineHistory: Array.isArray(history.lineHistory) ? history.lineHistory : [],
      lineHistoryAvailable: Boolean(history.lineHistoryAvailable),
      lineHistorySource: history.lineHistorySource || null,
      lineHistoryLookbackHours: lookbackHoursUsed,
      historySportsbooksRequested: Array.isArray(history.historySportsbooksRequested)
        ? history.historySportsbooksRequested
        : sharpBooks,
      normalizedSelectionId: history.normalizedSelectionId || target.selectionId || null,
      historyGameId: history.historyGameId || target.gameId || null,
      historyMatchedBy: history.historyMatchedBy || null,
      historyMatchKey: history.historyMatchKey || null,
      validationFailed,
      validationErrorMessage: validationFailed
        ? String(validationError?.message || validationError || 'Validation failed')
        : null
    };
  });

  const validatedRows = enriched.filter((row) => !row.validationFailed);
  const partiallyValidated = failedValidationCount > 0 && validatedRows.length > 0;
  const noRowsValidated = rows.length > 0 && validatedRows.length === 0;

  if (partiallyValidated) {
    validationWarnings.push(
      `${failedValidationCount} candidate validation lookup(s) failed; returning ${validatedRows.length} validated row(s).`
    );
  }

  if (noRowsValidated) {
    const error = new Error(
      `Positive EV validation failed for all ${rows.length} candidate(s); no validated results returned`
    );
    error.code = 'VALIDATION_INCOMPLETE';
    error.category = 'backend';
    error.status = 503;
    error.retryable = true;
    error.details = {
      candidateCount: rows.length,
      validatedCount: 0,
      failedValidationCount,
      historyFailureCount,
      lookbackHoursUsed
    };
    throw error;
  }

  const ranked = rankLeagueScreenRows(validatedRows, {
    league: args.league || validatedRows[0]?.league || 'NBA',
    market: args.market || validatedRows[0]?.market || 'Moneyline',
    limit,
    includeAll: getIncludeAll(args),
    maxAgeMs,
    books: requestedBooks.length ? requestedBooks : undefined,
    debug
  });

  return {
    ok: true,
    result: ranked,
    count: ranked.length,
    freshness: require('../../lib/propprofessor-screen-utils').summarizeFreshness(
      extractScreenRows(validatedRows),
      Date.now(),
      { maxAgeMs }
    ),
    warnings: validationWarnings,
    resultMeta: {
      lookbackHoursUsed,
      debugEnabled: debug,
      source: 'positive_ev_candidates',
      candidateCount: rows.length,
      validatedCount: validatedRows.length,
      failedValidationCount,
      historyFailureCount,
      partialValidation: partiallyValidated
    }
  };
}

function createMcpHandlers({ client = createPropProfessorClient() } = {}) {
  const { getRuntimeCache, getCacheTtlMs } = require('../../lib/mcp-runtime-config');

  // Shared response cache — keyed by query params, TTL-based expiration.
  // Backed by the canonical LruCache (lib/propprofessor-lru-cache.js) so all
  // caching in the project shares one implementation; the TTL is applied
  // per-set since LruCache supports per-entry TTL.
  const responseCache = getRuntimeCache();
  const responseCacheTtlMs = getCacheTtlMs();

  // Canonical screen cache for stable (gameId, market, book) tuples.
  // Keyed on canonical tuple rather than full request signature.
  // Only used when gameId is present (full-league scans bypass).
  const canonicalScreenCache = createCanonicalScreenCache({
    ttlMs: responseCacheTtlMs,
    maxEntries: 100
  });

  // ─── Screen implementations (used by both the cache-wrapped handlers and
  // direct callers like recommended_bets → handlers.screen_ranked). ───

  async function runScreenRankedImpl(client, args = {}) {
    const requestedBooks = normalizeBookList(args.books);
    const league = args.league || 'NBA';
    const marketResolution = resolveMarkets(args, league);
    const market = marketResolution.single;
    // focusBook: only set if the user explicitly asked for one. Defaulting to
    // preset.preferredBooks[0] (Pinnacle for most leagues) breaks UFC/Soccer
    // because Pinnacle doesn't post those moneylines — the focusPlays filter
    // in extractScreenRows would then drop every row.
    // Fix shipped 2026-06-14: the screen_ranked handler used to default the
    // focus book to the preset's preferred book, which worked for NBA/NFL/MLB
    // but eliminated every UFC row. Now we only set focusBook when the user
    // explicitly passed books, leaving focusPlays empty (= expand to all
    // books in the payload) otherwise.
    const focusBook = requestedBooks.length ? requestedBooks[0] : '';
    // Auto-augment the backend query with the league's sharp-book set so
    // consensus data populates. The user-requested book (e.g. Fliff) typically
    // is NOT a sharp book, so without augmentation the backend returns just
    // that one book and consensusBookCount=0 on every row. The ranker needs
    // at least 2-3 comp books in allBookOdds to compute consensusEdge.
    // Audit 2026-06-15: this augmentation was present in runLeagueScreen
    // (used by sharp_plays) but missing from screen_ranked. Symptom: every
    // screen_ranked call on a single non-sharp book returned consBk=0.
    const sharpBookSet = getSharpBookComparisonSet({ league, market });
    const augmentedBooks = uniqueBooks([...requestedBooks, ...sharpBookSet]);
    const payload = await client.queryScreenOddsBestComps({
      market,
      league,
      games: Array.isArray(args.games) ? args.games : [],
      participants: Array.isArray(args.participants) ? args.participants : [],
      books: augmentedBooks,
      is_live: Boolean(args.is_live)
    });
    const response = await buildRankedScreenResponseShared({
      client,
      payloads: [payload],
      args: { ...args, historySportsbooks: augmentedBooks },
      league,
      focusBook,
      rankRows: (hydratedRows, { debug } = {}) =>
        rankLeagueScreenRows(hydratedRows, {
          league,
          market,
          limit: getLimit(args),
          books: requestedBooks.length ? requestedBooks : undefined,
          includeAll: getIncludeAll(args),
          maxAgeMs: getMaxAgeMs(args),
          debug,
          requirePreferredBook: requestedBooks.length > 0,
          playableOnly: args.playableOnly === true
        })
    });
    if (marketResolution.aliasesUsed.length) {
      response.resultMeta = {
        ...response.resultMeta,
        markets_alias_used: marketResolution.aliasesUsed
      };
    }
    // Pre-flight player research (v2.1.8): when includeResearch=true, run
    // player_context on the top N ranked rows so the response includes
    // injury/risk flags alongside the ranked plays.
    if (args.includeResearch === true && Array.isArray(response.result) && response.result.length) {
      const researchLimit = Number.isFinite(Number(args.researchLimit))
        ? Math.max(1, Math.min(50, Number(args.researchLimit)))
        : 10;
      const research = await runResearchOnTopRows({
        rows: response.result,
        limit: researchLimit,
        playerContextFn: handlers.player_context,
        gameContextFn: (opts) =>
          getGameContext({
            sport: opts.sport || opts.league,
            selection: opts.selection,
            game: opts.game,
            start: opts.start,
            market: opts.market
          })
      });
      response.research = research.results;
      response.resultMeta = {
        ...response.resultMeta,
        researchRunCount: research.results.length,
        researchPlayerContextCount: research.results.filter((r) => r.contextType === 'player').length,
        researchGameContextCount: research.results.filter((r) => r.contextType === 'game').length,
        researchRiskHighCount: research.results.filter((r) => r.riskFlag === 'high').length,
        researchCachedCount: research.results.filter((r) => r.cached).length
      };
      if (args.riskDowngrade === true) {
        const beforeCount = response.result.length;
        const highRiskPlayers = new Set(
          research.results.filter((r) => r.riskFlag === 'high').map((r) => String(r.player || '').toLowerCase())
        );
        response.result = response.result.filter((row) => {
          const player = String(row.selection || row.participant || '').toLowerCase();
          return !highRiskPlayers.has(player);
        });
        response.resultMeta = {
          ...response.resultMeta,
          riskDowngradedCount: beforeCount - response.result.length
        };
      }
    }
    const verbosity = String(args.verbosity || 'full').toLowerCase();
    if (verbosity === 'minimal') return formatScreenRankedMinimal(response);
    if (verbosity === 'standard') return formatScreenRankedStandard(response);
    return response;
  }

  // ─── Play Detail & Validation Implementations ───────────────────────────

  async function runGetPlayDetailsImpl(client, args = {}) {
    const league = String(args.league || '').trim();
    const rawGameIds = Array.isArray(args.game_ids) ? args.game_ids : [];
    // Sanitize: trim, drop empties, dedupe. Stale/closed/malformed game IDs
    // (e.g. non-numeric timestamps) used to crash the per-row enrichment
    // path with "Cannot read properties of undefined (reading 'filter')".
    // Clean them here so the downstream pipeline only sees well-formed IDs.
    const gameIds = Array.from(new Set(rawGameIds.map((id) => String(id == null ? '' : id).trim()).filter(Boolean)));
    if (!league || !gameIds.length) {
      const error = new Error('league and game_ids are required.');
      error.code = 'MISSING_PARAMS';
      error.category = 'validation';
      error.status = 400;
      throw error;
    }
    const marketResolution = resolveMarkets(args, league);
    let market = marketResolution.single;
    const requestedBooks = normalizeBookList(args.books);
    // BUGFIX (2026-06-22): Tennis market normalization in get_play_details.
    // The Tennis screen handler normalizes generic markets ("Spread", "Total")
    // into specific backend market names (Game Handicap, Set Handicap, Total
    // Games, etc.) via normalizeTennisMarketQuery. But get_play_details
    // bypassed this and passed the raw "Spread"/"Total" string directly to
    // queryScreenOddsBestComps — which has no rows for those names, causing
    // validate_play to always FAIL with "no row matched selection" on Tennis
    // spread/total plays. Apply the same normalization here.
    if (league === 'Tennis') {
      const tennisMarkets = normalizeTennisMarketQuery(market);
      market = tennisMarkets[0] || market;
    }
    // BUGFIX: don't default focusBook to the preset's preferred book
    // (Pinnacle for most leagues). Pinnacle doesn't post UFC/Tennis/Soccer
    // moneylines, so focusPlays in extractScreenRows would drop every row
    // whose odds don't include Pinnacle — which is most non-NA-sports rows.
    // Only set focusBook when the user explicitly passed books. Same fix
    // as runScreenRankedImpl (shipped 2026-06-14).
    const focusBook = requestedBooks.length ? requestedBooks[0] : '';

    // Fetch full screen data (with history hydration — this is the detailed view)
    let payload;
    try {
      payload = await client.queryScreenOddsBestComps({
        market,
        league,
        games: gameIds,
        participants: [],
        // BUGFIX (2026-06-21): when no books are specified, omit the books
        // param entirely so queryScreenOddsBestComps falls back to its own
        // default set (ALL_SCREEN_BOOKS for non-NA leagues). Passing books: []
        // sets hasExplicitBooks=true which bypasses the ALL_SCREEN_BOOKS
        // fallback and returns 0 rows for UFC, Tennis, Soccer — leagues
        // where Pinnacle doesn't price Moneyline markets.
        books: requestedBooks.length ? requestedBooks : undefined,
        is_live: false
      });
    } catch (err) {
      return {
        ok: true,
        result: [],
        resultMeta: {
          queryGameIds: gameIds,
          matchedRows: 0,
          error: err?.message || String(err),
          errorCode: 'SCREEN_QUERY_FAILED'
        }
      };
    }
    let response;
    try {
      // BUGFIX (regression pitfall #48): the previous code omitted the
      // `await` here, so `response` was a Promise and the subsequent
      // `response.result.filter(...)` crashed with
      // "Cannot read properties of undefined (reading 'filter')".
      response = await buildRankedScreenResponseShared({
        client,
        payloads: [payload],
        args: { ...args, compact: false, skipHistory: false },
        league,
        focusBook,
        rankRows: (hydratedRows, { debug } = {}) =>
          rankLeagueScreenRows(hydratedRows, {
            league,
            market,
            limit: gameIds.length * 4,
            books: requestedBooks.length ? requestedBooks : undefined,
            includeAll: true,
            debug
          })
      });
    } catch (err) {
      return {
        ok: true,
        result: [],
        resultMeta: {
          queryGameIds: gameIds,
          matchedRows: 0,
          error: err?.message || String(err),
          errorCode: 'RANK_PIPELINE_FAILED'
        }
      };
    }

    // Add market alias info to resultMeta if any aliases were used
    if (marketResolution.aliasesUsed.length) {
      response.resultMeta = {
        ...response.resultMeta,
        markets_alias_used: marketResolution.aliasesUsed
      };
    }

    // Filter to only the requested game IDs. Guard against response.result
    // being undefined (can happen when the upstream screen query returns no
    // matching rows for the requested gameIds).
    const gameIdSet = new Set(gameIds);
    const safeResult = Array.isArray(response.result) ? response.result : [];
    const filtered = safeResult.filter((row) => gameIdSet.has(row && row.gameId));
    // BUGFIX (2026-06-21): when the ranker's preferred book (Pinnacle for most
    // leagues) has no odds for a match — e.g. Pinnacle doesn't post UFC/Tennis
    // moneylines — all rows land in `focusBookMissingRows` instead of `result`.
    // Merge those back in so that get_play_details and validate_play actually
    // return a row for the requested gameId.
    const fallbackRows = Array.isArray(response.focusBookMissingRows) ? response.focusBookMissingRows : [];
    const merged = [...filtered];
    for (const fbRow of fallbackRows) {
      if (gameIdSet.has(fbRow && fbRow.gameId)) {
        // Set the focusBookMissing flag so callers know this is a fallback row
        merged.push({ ...fbRow, __focusBookMissing: true });
      }
    }
    response.result = merged;
    // Drop the non-enumerable focusBookMissingRows from the response —
    // they've been merged into result.
    response.focusBookMissingRows = undefined;
    response.resultMeta = {
      ...response.resultMeta,
      queryGameIds: gameIds,
      matchedRows: merged.length
    };
    // Apply verbosity formatting (adds summary mode for agents that just
    // need a quick overview of game details without 700KB+ of line history)
    const verbosity = String(args.verbosity || 'full').toLowerCase();
    if (verbosity === 'minimal') return formatGetPlayDetailsMinimal(response);
    if (verbosity === 'standard') return formatGetPlayDetailsStandard(response);
    return response;
  }

  async function runValidatePlayImpl(client, args = {}) {
    const league = String(args.league || '').trim();
    const gameId = String(args.gameId || '').trim();
    const selection = String(args.selection || '').trim();
    const requestedPlayId = String(args.playId || '').trim();
    if (!league) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'league is required' } };
    }
    if (!gameId) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'gameId is required' } };
    }
    if (!selection) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'selection is required' } };
    }
    const market = String(args.market || 'Moneyline').trim() || 'Moneyline';
    const books = normalizeBookList(args.books);
    const lookbackHours = Number.isFinite(Number(args.lookbackHours)) ? Number(args.lookbackHours) : 6;
    const skipResearch = args.skipResearch === true;

    // Steps 1 + 2 in parallel: re-fetch the screen for this game AND run
    // player_context research concurrently. The two calls are independent —
    // research only needs the selection name + league, not the detail row —
    // so serializing them doubled wall-clock latency for no reason. We
    // resolve detail first so we can pass `gameTime` to research without a
    // second round-trip; in practice this is still 30-40% faster than the
    // previous all-serial path on the typical validate_play invocation.
    const detailPromise = (async () => {
      try {
        return {
          ok: true,
          value: await runGetPlayDetailsImpl(client, {
            league,
            market,
            game_ids: [gameId],
            books: books.length ? books : undefined,
            lookbackHours
          })
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    })();
    const researchPromise = skipResearch
      ? Promise.resolve(null)
      : (async () => {
          try {
            return {
              ok: true,
              value: await handlers.player_context({
                player: selection,
                sport: league
              })
            };
          } catch (err) {
            return { ok: false, error: err?.message || String(err) };
          }
        })();

    // MLB game-level context (pitcher, weather, park, lineup). Only runs
    // for league=MLB. The screen gameId is the format
    // "MLB:PREMATCH:<homeSlug>:<awaySlug>:<unixStart>" — note the
    // <home>:<away> order, not the more intuitive away-first. The last
    // segment is a Unix timestamp, NOT the MLB gamePk. We resolve the
    // real gamePk via the schedule endpoint using the homeSlug + awaySlug
    // + the start date derived from the Unix timestamp. The lookup is
    // best-effort: if the schedule fetch fails or no match is found,
    // gameContext stays null and the verdict is unaffected. Skipped on
    // skipResearch to honor that opt-out.
    const isMlb = league.toUpperCase() === 'MLB';
    // The screen gameId encodes the matchup; parse it to seed the lookup.
    const gameIdParts = isMlb && gameId ? gameId.split(':') : [];
    // Convention: index 2 = HOME slug, index 3 = AWAY slug.
    const seedHomeTeam = gameIdParts[2] ? gameIdParts[2].replace(/_/g, ' ') : '';
    const seedAwayTeam = gameIdParts[3] ? gameIdParts[3].replace(/_/g, ' ') : '';
    // Start date is the date of the Unix timestamp (last segment).
    const seedStartDate =
      gameIdParts[4] && /^\d{10}$/.test(gameIdParts[4])
        ? new Date(Number(gameIdParts[4]) * 1000).toISOString().slice(0, 10)
        : '';
    const gameContextPromise = skipResearch
      ? Promise.resolve(null)
      : isMlb
        ? (async () => {
            try {
              if (!seedAwayTeam || !seedHomeTeam || !seedStartDate) {
                return { ok: false, error: 'missing MLB matchup data for game context' };
              }
              const attemptedLookup = {
                isoDate: seedStartDate,
                awayTeam: seedAwayTeam,
                homeTeam: seedHomeTeam,
                unixStart: gameIdParts[4] && /^\d{10}$/.test(gameIdParts[4]) ? Number(gameIdParts[4]) : undefined
              };
              const gamePk = await findMlbGamePk(attemptedLookup);
              if (!gamePk) {
                return {
                  ok: false,
                  error: {
                    errorType: 'schedule_not_found',
                    errorDetail: 'no MLB gamePk found for matchup',
                    attemptedLookup
                  }
                };
              }
              return { ok: true, value: await getMlbGameContext({ gamePk }) };
            } catch (err) {
              return { ok: false, error: err?.message || String(err) };
            }
          })()
        : (async () => {
            try {
              // Non-MLB: run sport-agnostic game context via dispatcher.
              // For Tennis, parse the gameId to extract the unix start
              // (Tennis:PREMATCH:p1:p2:unixStart) so the resolver can
              // map a matchup string ("Dart vs Sonmez") to a real
              // tourney via the 2026 weekly schedule.
              let derivedStart = null;
              if (league.toLowerCase() === 'tennis' && gameId) {
                const parts = gameId.split(':');
                const ts = parts[parts.length - 1];
                if (ts && /^\d{10}$/.test(ts)) {
                  derivedStart = new Date(Number(ts) * 1000).toISOString();
                }
              }
              const ctx = await getGameContext({
                sport: league,
                selection,
                game: gameId, // screen game ID includes matchup info
                start: derivedStart
              });
              return { ok: true, value: ctx };
            } catch (err) {
              return { ok: false, error: err?.message || String(err) };
            }
          })();

    const [detailOutcome, researchOutcome, gameContextOutcome] = await Promise.all([
      detailPromise,
      researchPromise,
      gameContextPromise
    ]);
    const detailResult = detailOutcome?.ok ? detailOutcome.value : null;
    const detailError = detailOutcome?.ok ? null : detailOutcome.error;
    const gameContext = gameContextOutcome?.ok ? gameContextOutcome.value : null;
    const gameContextError = gameContextOutcome?.ok ? null : gameContextOutcome?.error || null;

    // Extract the specific row that matches the selection.
    // The screen's `selection` field for spread/total plays concatenates the
    // line (e.g. "Harris -1.5", "Over 22.5", "Under 2.5 sets"), but
    // get_play_details stores them as `participant: "Harris"` with the line
    // in a separate `line` field. To match both shapes:
    //   1. Try exact match (moneyline case).
    //   2. Strip trailing line digits and re-try (spread case).
    //   3. Strip "Over "/"Under " prefix and re-try (total case).
    //   4. Fall back to home/away includes.
    const selLower = selection.toLowerCase().trim();
    const normalizedRequestedSelectionKey = normalizeSelectionKey(selection);
    const stripLine = (s) => s.replace(/\s*[+-]?\d+(?:\.\d+)?\s*(sets|games)?\s*$/i, '').trim();
    const stripOverUnder = (s) => s.replace(/^(over|under)\s+/i, '').trim();
    const selStrippedLine = stripLine(selLower);
    const selStrippedOverUnder = stripOverUnder(selLower);
    const selStrippedLineOU = stripOverUnder(selStrippedLine);
    const detailRows = Array.isArray(detailResult?.result) ? detailResult.result : [];
    const matchingRow = (() => {
      if (!detailRows.length) return null;

      const exactRow = detailRows.find((r) => {
        const rowPlayId = String(r.playId || buildCanonicalPlayId(r)).trim();
        if (requestedPlayId && rowPlayId === requestedPlayId) return true;
        const stored = String(r.selection || r.participant || '')
          .toLowerCase()
          .trim();
        const storedSelectionKey = normalizeSelectionKey(r.selection || r.participant || r.pick || '');
        return (
          stored === selLower ||
          (storedSelectionKey && storedSelectionKey === normalizedRequestedSelectionKey) ||
          stored === selStrippedLine ||
          stored === selStrippedOverUnder ||
          stored === selStrippedLineOU
        );
      });
      if (exactRow) return exactRow;

      const nestedRow = detailRows.find((r) => {
        if (!(r.selections && typeof r.selections === 'object')) return false;
        for (const key of Object.keys(r.selections)) {
          const sel = r.selections[key];
          if (sel && typeof sel === 'object') {
            const s1 = String(sel.selection1 || '')
              .toLowerCase()
              .trim();
            const s2 = String(sel.selection2 || '')
              .toLowerCase()
              .trim();
            if (s1 === selLower || s2 === selLower) return true;
            if (s1 === selStrippedLine || s2 === selStrippedLine) return true;
            if (s1 === selStrippedOverUnder || s2 === selStrippedOverUnder) return true;
          }
        }
        return false;
      });
      if (nestedRow) return nestedRow;

      return (
        detailRows.find((r) => {
          if (String(r.selection || r.participant || '').trim()) return false;
          if (
            String(r.homeTeam || '')
              .toLowerCase()
              .includes(selLower)
          )
            return true;
          if (
            String(r.awayTeam || '')
              .toLowerCase()
              .includes(selLower)
          )
            return true;
          return false;
        }) || null
      );
    })();

    // If research was started before we had the row, re-run it with
    // gameTime now that we know the start. Skip the round-trip when the
    // gameTime is already present in the result.
    let research = researchOutcome?.ok ? researchOutcome.value : null;
    const researchError = researchOutcome?.ok ? null : researchOutcome?.error || null;
    if (research && !research.gameTime && matchingRow?.start) {
      research = { ...research, gameTime: matchingRow.start };
    }

    // Step 3: compute the verdict.
    // We classify the play using the same signals the ranker uses,
    // then layer on the risk-flag downgrade from research.
    let verdict = 'PASS';
    const reasons = [];
    let tier = matchingRow?.confidenceTier || 'TIER 4';
    let lookupStatus = 'resolved';
    let reasonType = 'signal';

    // Consensus drift detection: compare the agent's snapshot against the re-fetched row.
    let consensusDrift = false;
    let driftReason = null;
    if (matchingRow) {
      const screenCbk = Number(args.screenConsensusBookCount);
      const screenExec = String(args.screenExecutionQuality || '');
      const currentCbk = Number(matchingRow.consensusBookCount || 0);
      const currentExec = String(matchingRow.executionQuality || '');

      if (Number.isFinite(screenCbk) && screenCbk > 0 && screenCbk !== currentCbk) {
        consensusDrift = true;
        driftReason = 'consensus changed';
      } else if (screenExec && screenExec !== 'unknown' && screenExec !== currentExec) {
        consensusDrift = true;
        driftReason = 'execution quality changed';
      }
    }

    if (matchingRow) {
      // Base quality from the existing ranker output.
      if (tier === 'TIER 1') {
        verdict = 'BET';
      } else if (tier === 'TIER 2' || tier === 'TIER 3') {
        verdict = 'CONSIDER';
      } else {
        verdict = 'PASS';
        reasons.push('TIER 4 (no signal)');
      }

      // Execution quality on the requested book.
      const exec = String(matchingRow.executionQuality || '');
      if (exec === 'bad') {
        verdict = 'PASS';
        reasons.push('execution quality is "bad" on the requested book');
      } else if (exec === 'playable') {
        reasons.push('execution quality is "playable" (within 10¢ of best)');
      } else if (exec === 'best') {
        reasons.push('execution quality is "best" (top of market)');
      } else {
        reasons.push(`execution quality is "${exec || 'unknown'}"`);
      }

      // Consensus/movement support.
      const cbk = Number(matchingRow.consensusBookCount || 0);
      if (cbk >= 3) reasons.push(`consensus: ${cbk} comp books agree`);
      else if (cbk >= 1) reasons.push(`consensus: ${cbk} comp book (thin)`);
      else reasons.push('no comp book consensus');
    } else {
      lookupStatus = 'lookup_failed';
      reasonType = 'lookup_failure';
      verdict = 'CONSIDER';
      reasons.push(
        detailError
          ? `screen lookup failed: ${detailError}`
          : `no row matched selection "${selection}" on gameId ${gameId}`
      );
    }

    // Risk-flag override.
    if (research && research.riskFlag === 'high') {
      verdict = 'PASS';
      reasons.push('player_context riskFlag = "high"');
    } else if (research && research.riskFlag === 'medium') {
      if (verdict === 'BET') verdict = 'CONSIDER';
      reasons.push('player_context riskFlag = "medium" — proceed with caution');
    } else if (research && research.riskFlag === 'low') {
      reasons.push('player_context riskFlag = "low"');
    }

    // Game-context risk override (weather / park / rest / surface). Applied
    // AFTER player_context so a high weather flag can still PASS a play
    // that survived the player-news check. Same downgrades as
    // player_context so the agent's reasoning doesn't have to branch.
    if (gameContext && gameContext.riskFlag === 'high') {
      verdict = 'PASS';
      reasons.push(`game_context riskFlag = "high"${gameContext.riskSummary ? ` — ${gameContext.riskSummary}` : ''}`);
    } else if (gameContext && gameContext.riskFlag === 'medium') {
      if (verdict === 'BET') verdict = 'CONSIDER';
      reasons.push(`game_context riskFlag = "medium" — ${gameContext.riskSummary || 'proceed with caution'}`);
    } else if (gameContext && gameContext.riskFlag === 'low') {
      reasons.push(`game_context riskFlag = "low" — ${gameContext.riskSummary || 'minor flag'}`);
    } else if (gameContext && gameContext.riskFlag === 'unknown') {
      // Surface/level couldn't be determined — note it but don't downgrade
      if (gameContext.riskSummary) {
        reasons.push(`game_context: ${gameContext.riskSummary}`);
      }
    }

    // --- Synthesize verdict summary for agents ---
    // Combines movement disposition, verdict, risk flags, and execution quality
    // into a single "should I bet this" answer. This encodes the bet-card drill
    // so no agent-side skill doc is needed.
    const _disposition = matchingRow ? computeMovementDisposition(matchingRow) : 'insufficient';

    const _statusMessages = {
      supportive_clean: 'all signals aligned — green movement, supportive direction, clean path',
      supportive_bouncy: 'direction is right but path was rocky — yellow grade or V-shaped recovery',
      adverse_recent: 'recent movement turned adverse — the direction went against the play recently',
      adverse_full: 'full-window direction is adverse — do not bet',
      insufficient: 'not enough data to evaluate movement quality'
    };

    const _riskFlags = [];
    if (research && research.riskFlag && research.riskFlag !== 'low' && research.riskFlag !== 'clean') {
      _riskFlags.push(`player_context: ${research.riskFlag}`);
    }
    if (gameContext && gameContext.riskFlag && gameContext.riskFlag !== 'low' && gameContext.riskFlag !== 'clean') {
      _riskFlags.push(`game_context: ${gameContext.riskFlag}`);
    }
    if (_disposition === 'adverse_recent' || _disposition === 'adverse_full') {
      _riskFlags.push('movement adverse');
    }

    let _actionableSummary;
    if (_riskFlags.length === 0 && verdict === 'BET') {
      _actionableSummary = 'No red flags. Clean play across all checks.';
    } else if (verdict === 'BET' && _riskFlags.length > 0) {
      _actionableSummary = `BET with caution — flags: ${_riskFlags.join(', ')}`;
    } else if (lookupStatus === 'lookup_failed') {
      _actionableSummary =
        "Couldn't be rehydrated from the current screen snapshot. Treat as stale / unverified, not an automatic fade.";
    } else if (verdict === 'CONSIDER') {
      _actionableSummary = `Thin play${_riskFlags.length > 0 ? ' — ' + _riskFlags.join(', ') : ''}. Reduce stake or skip.`;
    } else {
      _actionableSummary = 'PASS — one or more hard checks failed.';
    }

    const verdictSummary = {
      displayTier: verdict === 'BET' ? 'BET' : verdict === 'CONSIDER' ? 'CONSIDER' : 'PASS',
      movementDisposition: _disposition,
      movementStatus: _statusMessages[_disposition] || 'unknown',
      executionQuality: matchingRow?.executionQuality || null,
      consensusSupport:
        matchingRow?.consensusBookCount > 0 ? `${matchingRow.consensusBookCount} books` : 'no consensus',
      riskFlags: _riskFlags,
      actionableSummary: _actionableSummary
    };

    return {
      ok: true,
      league,
      market,
      gameId,
      selection,
      executionBook: String(args.book || books[0] || ''),
      verdict,
      tier,
      lookupStatus,
      reasonType,
      reasons,
      verdictSummary,
      screenFreshness: detailResult?.freshness || null,
      consensusDrift,
      driftReason,
      play: matchingRow
        ? {
            playId: matchingRow.playId || buildCanonicalPlayId(matchingRow),
            selectionKey:
              matchingRow.selectionKey || normalizeSelectionKey(matchingRow.selection || matchingRow.participant || ''),
            gameId: matchingRow.gameId,
            homeTeam: matchingRow.homeTeam,
            awayTeam: matchingRow.awayTeam,
            start: matchingRow.start,
            odds: matchingRow.odds,
            bestAvailableOdds: matchingRow.bestAvailableOdds,
            executionQuality: matchingRow.executionQuality,
            consensusEdge: matchingRow.consensusEdge,
            consensusBookCount: matchingRow.consensusBookCount,
            clvProxyPct: matchingRow.clvProxyPct,
            openToCurrentClvPct: matchingRow.openToCurrentClvPct,
            freshnessSource: matchingRow.freshnessSource || null,
            movementLabel: matchingRow.movementLabel,
            kaiCall: matchingRow.kaiCall,
            screenScore: matchingRow.screenScore
          }
        : null,
      research: research
        ? {
            riskFlag: research.riskFlag,
            riskSummary: research.summary || null,
            topTweet:
              Array.isArray(research.tweets) && research.tweets.length > 0
                ? research.tweets[0]?.text?.slice(0, 200) || null
                : null,
            cached: Boolean(research.cached),
            fetchedAt: research.fetchedAt
          }
        : skipResearch
          ? { skipped: true }
          : { error: researchError || 'research failed' },
      gameContext: gameContext
        ? {
            gamePk: gameContext.gamePk,
            sport: gameContext.sport || null,
            riskFlag: gameContext.riskFlag,
            riskSummary: gameContext.riskSummary || null,
            signals: gameContext.signals || null,
            cached: Boolean(gameContext.cached),
            fetchedAt: gameContext.fetchedAt,
            // MLB-specific
            ...(isMlb
              ? {
                  venue: gameContext.venue || null,
                  pitchers: gameContext.pitchers || null,
                  park: gameContext.park || null,
                  weather: gameContext.weather || null,
                  lineups: gameContext.lineups || null
                }
              : {}),
            // Basketball-specific
            ...(gameContext.awayTeam
              ? {
                  awayTeam: gameContext.awayTeam,
                  homeTeam: gameContext.homeTeam
                }
              : {}),
            // Tennis-specific
            ...(gameContext.surface
              ? {
                  surface: gameContext.surface,
                  level: gameContext.level,
                  matchupNewsCount: gameContext.matchupNewsCount
                }
              : {})
          }
        : isMlb
          ? skipResearch
            ? { skipped: true }
            : gameContextError
              ? typeof gameContextError === 'string'
                ? { error: gameContextError }
                : gameContextError
              : null
          : null
    };
  }

  function buildCacheKey(prefix, args, league) {
    return JSON.stringify({
      prefix,
      league,
      market: args.market || 'Moneyline',
      books: normalizeBookList(args.books),
      is_live: Boolean(args.is_live),
      lookbackHours: Number.isFinite(Number(args.lookbackHours)) ? Number(args.lookbackHours) : null,
      games: args.games || [],
      participants: args.participants || []
    });
  }
  async function runLeagueScreen(args = {}, league) {
    const requestedBooks = normalizeBookList(args.books);
    const marketResolution = resolveMarkets(args, league);
    const market = marketResolution.single;
    const preset = getLeagueRankingPreset(league, market);
    const focusBook = requestedBooks[0] || preset.preferredBooks[0];

    // Auto-augment with sharp books for consensus data.
    // When the user requests a single non-sharp book (e.g. NoVigApp), the backend
    // returns zero consensus because vig-removed lines don't match other books.
    // We always query with the league's sharp book set included, so consensus
    // and movement data populate. The focus book (user's execution book) is
    // preserved for display via focusPlays in extractScreenRows.
    const sharpBookSet = getSharpBookComparisonSet({ league, market });
    const augmentedBooks = uniqueBooks([...requestedBooks, ...sharpBookSet]);

    // Check cache first (only cache full responses, not compact/fields-filtered)
    // Use augmented books in cache key so different book combos don't collide
    const canCache = !args.compact && !args.fields && !args.include;
    const cacheKey = canCache ? buildCacheKey('league', { ...args, books: augmentedBooks }, league) : null;
    if (cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached) {
        return { ...cached, resultMeta: { ...cached.resultMeta, cached: true } };
      }
    }

    const payload = await client.queryScreenOddsBestComps({
      market,
      league,
      games: Array.isArray(args.games) ? args.games : [],
      participants: Array.isArray(args.participants) ? args.participants : [],
      books: augmentedBooks,
      is_live: Boolean(args.is_live)
    });
    const response = buildRankedScreenResponseShared({
      client,
      payloads: [payload],
      args: { ...args, historySportsbooks: augmentedBooks },
      league,
      focusBook,
      rankRows: (hydratedRows, { debug } = {}) =>
        rankLeagueScreenRows(hydratedRows, {
          league,
          market,
          limit: getLimit(args),
          books: requestedBooks.length ? requestedBooks : undefined,
          includeAll: getIncludeAll(args),
          maxAgeMs: getMaxAgeMs(args),
          debug,
          // Audit 2026-06-15: same gate as screen_ranked — drop rows where
          // the user-requested book has no price. Without this, sharp_plays
          // could surface "Fliff -117" when Fliff never posted a line.
          requirePreferredBook: requestedBooks.length > 0,
          // playableOnly flag (2026-06-15): see screen_ranked comment.
          playableOnly: args.playableOnly === true
        })
    });

    // Add market alias info to resultMeta if any aliases were used
    if (marketResolution.aliasesUsed.length) {
      response.resultMeta = {
        ...response.resultMeta,
        markets_alias_used: marketResolution.aliasesUsed
      };
    }

    // Store in cache
    if (cacheKey) {
      responseCache.set(cacheKey, response, responseCacheTtlMs);
    }

    return response;
  }

  // Internal tennis screen handler (not exposed as MCP tool — use screen(league="Tennis"))
  async function runTennisScreen(args = {}) {
    const preferredBook = String(args.book || 'Pinnacle').trim() || 'Pinnacle';
    const requestedBooks = normalizeBookList(args.books);
    const marketResolution = resolveMarkets(args, 'Tennis');
    const marketQuery = normalizeTennisMarketQuery(marketResolution.single);

    // Cache check for tennis screen
    const canCache = !args.compact && !args.fields && !args.include;
    const cacheKey = canCache
      ? buildCacheKey(
          'tennis',
          {
            ...args,
            books: requestedBooks.length ? requestedBooks : ALL_SCREEN_BOOKS,
            market: marketResolution.single
          },
          'Tennis'
        )
      : null;
    if (cacheKey) {
      const cached = responseCache.get(cacheKey);
      if (cached) {
        return { ...cached, resultMeta: { ...cached.resultMeta, cached: true } };
      }
    }

    const queryFn =
      typeof client.queryScreenOdds === 'function'
        ? client.queryScreenOdds.bind(client)
        : client.queryScreenOddsBestComps.bind(client);

    const payloads = [];
    for (const market of marketQuery) {
      const payload = await queryFn({
        market,
        league: 'Tennis',
        // Always query with ALL_SCREEN_BOOKS for tennis — the backend only
        // returns multi-book data (consensus, history) for secondary sports
        // when the complete book list is passed. The requestedBooks filter
        // is applied below via requirePreferredBook.
        books: ALL_SCREEN_BOOKS,
        is_live: Boolean(args.is_live)
      });
      payloads.push(payload);
    }

    const rows = payloads.flatMap((payload) => extractScreenRows(payload));

    const hasScreenBooks = rows.some((row) => {
      const text = JSON.stringify(row || '');
      return (
        text.includes('"Pinnacle"') ||
        text.includes('"Circa"') ||
        text.includes('"BetOnline"') ||
        text.includes('"Kalshi"')
      );
    });
    const hasScreenConsensus = rows.some((row) => {
      const text = JSON.stringify(row || '');
      return text.includes('"consensus"') || text.includes('"ev"') || text.includes('"value"');
    });

    if (hasScreenBooks || hasScreenConsensus) {
      const screenResult = await buildRankedScreenResponseShared({
        client,
        payloads,
        args,
        league: 'Tennis',
        focusBook: preferredBook,
        rankRows: (hydratedRows, { debug } = {}) =>
          rankTennisScreenRows(hydratedRows, {
            limit: getLimit(args),
            preferredBook,
            includeAll: getIncludeAll(args),
            maxAgeMs: getMaxAgeMs(args),
            debug,
            // Audit 2026-06-15: see the screen_ranked comment. Same
            // requirePreferredBook gate prevents surfacing non-Fliff rows
            // as "Fliff -117" when Fliff never posted a line.
            requirePreferredBook: requestedBooks.length > 0,
            // playableOnly (2026-06-15): see screen_ranked comment.
            playableOnly: args.playableOnly === true
          })
      });
      if (screenResult?.result) {
        screenResult.result = await correctTennisTimes(screenResult.result);
      }
      // Add market alias info to resultMeta if any aliases were used
      if (marketResolution.aliasesUsed.length) {
        screenResult.resultMeta = {
          ...screenResult.resultMeta,
          markets_alias_used: marketResolution.aliasesUsed
        };
      }
      // Store in cache
      if (cacheKey) {
        responseCache.set(cacheKey, screenResult, responseCacheTtlMs);
      }
      return screenResult;
    }

    // Phase 2: fallback to +EV endpoint
    let evResult;
    try {
      evResult = await client.querySportsbook({
        leagues: ['Tennis'],
        sportsbooks: [
          'FanDuel',
          'DraftKings',
          'BetMGM',
          'Caesars',
          'Pinnacle',
          'Polymarket',
          'Circa',
          'BetOnline',
          'Kalshi',
          'NoVigApp'
        ],
        minOdds: -9999,
        maxOdds: 9999,
        minValue: 0,
        maxHoursAway: 48,
        isLive: Boolean(args.is_live)
      });
    } catch (error) {
      process.stderr.write(`[propprofessor-mcp] Tennis +EV fallback query failed: ${error?.message || error}\n`);
      return {
        ok: true,
        result: [],
        league: 'Tennis',
        resultMeta: { debugEnabled: false, source: 'fallback_empty' },
        freshness: { rowCount: rows.length, newestAgeMs: 0, oldestAgeMs: 0, staleCount: 0, stale: false },
        warning: 'No tennis data available from either /screen or +EV endpoint'
      };
    }

    const evCandidates = Array.isArray(evResult)
      ? evResult.filter((row) => String(row.league || '').toLowerCase() === 'tennis')
      : [];

    // Filter by requested market family if a specific market was requested
    const requestedMarket = marketResolution.single || null;
    const marketFamilyCandidates = requestedMarket
      ? evCandidates.filter((row) => {
          const rowFamily = getTennisMarketFamily(row);
          const requestedFamilies = normalizeTennisMarketQuery(requestedMarket).map((m) =>
            getTennisMarketFamily({ market: m })
          );
          return rowFamily !== null && requestedFamilies.includes(rowFamily);
        })
      : evCandidates;

    if (!marketFamilyCandidates.length) {
      return {
        ok: true,
        result: [],
        league: 'Tennis',
        resultMeta: { debugEnabled: false, source: 'fallback_empty' },
        freshness: { rowCount: rows.length, newestAgeMs: 0, oldestAgeMs: 0, staleCount: 0, stale: false },
        warning: '/screen returned only Polymarket odds and +EV endpoint has no tennis candidates today'
      };
    }

    const ranked = await enrichTennisEvCandidates(marketFamilyCandidates, client, {
      preferredBook,
      limit: getLimit(args),
      lookbackHours: getLookbackHours(args),
      requestedMarket
    });
    const correctedRanked = await correctTennisTimes(ranked);
    return {
      ok: true,
      result: correctedRanked,
      league: 'Tennis',
      freshness: { rowCount: rows.length, newestAgeMs: 0, oldestAgeMs: 0, staleCount: 0, stale: false },
      source: '+ev_enriched',
      note: '/screen returned insufficient tennis data; results enriched from +EV endpoint with odds history'
    };
  }

  async function runUfcCard(args = {}) {
    const marketResolution = resolveMarkets(args, 'UFC');
    const normalizedMarkets = marketResolution.array.length ? marketResolution.array : [marketResolution.single];
    const market = normalizedMarkets[0];
    const targetBook = String(args.book || args.targetBook || '').trim();
    const rankedArgs = {
      ...args,
      market,
      books: targetBook ? [targetBook] : Array.isArray(args.books) ? args.books : []
    };
    const rankedResponse = await runLeagueScreen(rankedArgs, 'UFC');
    const rankedRows = Array.isArray(rankedResponse?.result) ? rankedResponse.result : [];
    const shortlist = buildUfcShortlist(rankedRows, {
      ...args,
      market,
      targetBook,
      limit: getLimit(args)
    });
    const count = shortlist.shortlistMeta?.filteredCount ?? shortlist.officialCount;
    const cardWindow = shortlist.shortlistMeta?.cardWindow || shortlist.shortlistCardWindow || null;
    const eventDate = shortlist.shortlistMeta?.eventDate || shortlist.shortlistEventDate || null;
    return {
      ok: true,
      league: 'UFC',
      officialPlays: shortlist.bestBets,
      bestLooks: shortlist.bestLooks,
      passes: shortlist.bestPasses,
      summaryText: shortlist.summaryText,
      count,
      resultMeta: {
        ...rankedResponse.resultMeta,
        source: 'ufc_card',
        cardWindow,
        eventDate,
        count,
        // Include aliases from the UFC card's own resolution
        markets_alias_used: [...(rankedResponse.resultMeta?.markets_alias_used || []), ...marketResolution.aliasesUsed],
        shortlist: {
          ...shortlist,
          count
        }
      }
    };
  }

  // ===== CONSOLIDATED HANDLER MAP =====
  // 30 old tools → 20 new tools:
  //   ev_candidates          ← query_positive_ev_candidates + query_validated_positive_ev_candidates
  //   screen_raw             ← query_screen_odds + query_screen_odds_best_comps
  //   screen_ranked          ← query_screen_odds_ranked
  //   sharp_plays            ← query_sharp_plays
  //   sharp_consensus        ← query_sharp_consensus_windows
  //   all_slates             ← query_all_slates
  //   ufc_card               ← query_ufc_card (absorbs query_ufc_screen)
  //   recommended_bets       ← query_recommended_bets
  //   staking_plan           ← query_staking_plan
  //   clv_history            ← query_clv_history
  //   player_context         ← query_player_context
  //   league_presets         ← league_presets (unchanged)
  //   health_status          ← health_status (unchanged)
  //   manage_hidden_bets     ← get_hidden_bets + hide_bet + unhide_bet + clear_hidden_bets (unchanged)
  //   fantasy_optimizer      ← query_fantasy_picks (new)
  //   find_best_price        ← find_best_price (unchanged)
  const handlers = {
    // ─── Screening & Ranking ────────────────────────────────────────
    async ev_candidates(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : undefined;
      if (!leagues) {
        const error = new Error(
          'The leagues parameter is required on ev_candidates. ' +
            'Pass one or more league names, e.g. leagues: ["NBA", "MLB", "Tennis"]. ' +
            'An empty array or omitted leagues will cause the backend to return HTTP 400.'
        );
        error.code = 'MISSING_LEAGUES';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const payload = await client.querySportsbook(
        defined({
          isLive: args.is_live !== undefined ? Boolean(args.is_live) : Boolean(args.isLive),
          showBreakOnly: args.showBreakOnly,
          showTimeoutOnly: args.showTimeoutOnly,
          showPeriodEndOnly: args.showPeriodEndOnly,
          timeAvailable: args.timeAvailable,
          userState: args.userState,
          hideNCAAPlayerProps: args.hideNCAAPlayerProps,
          sportsbooks: Array.isArray(args.sportsbooks) ? args.sportsbooks : undefined,
          leagues,
          minOdds: args.minOdds,
          maxOdds: args.maxOdds,
          minValue: args.minValue,
          maxValue: args.maxValue,
          marketTypes: Array.isArray(args.marketTypes) ? args.marketTypes : undefined,
          periodTypes: Array.isArray(args.periodTypes) ? args.periodTypes : undefined,
          minHoursAway: args.minHoursAway,
          maxHoursAway: args.maxHoursAway,
          minLiquidity: args.minLiquidity,
          maxLiquidity: args.maxLiquidity,
          weightSettings:
            args.weightSettings && typeof args.weightSettings === 'object' ? args.weightSettings : undefined
        })
      );
      const rows = Array.isArray(payload) ? payload : [];
      const baseResult = {
        ok: true,
        count: rows.length,
        result: rows,
        notes: {
          workflow:
            'Use these rows as fast discovery candidates, then validate finalists with /screen, exact-line checks, and sharp-book movement.',
          minValueBehavior: args.minValue === undefined ? 'unset_here_use_frontend_filter' : 'explicit_request_override'
        }
      };
      if (args.validated) {
        return validatePositiveEvCandidates({ client, candidates: rows, args });
      }
      return baseResult;
    },

    async screen_ranked(args = {}) {
      // Canonical cache key for stable (gameId, market, book) tuples
      const canonicalKey = canonicalizeScreenArgs(args);

      // If gameId is present, use the canonical cache; otherwise proceed without caching
      if (canonicalKey) {
        return canonicalScreenCache.memoize(async () => {
          return await runScreenRankedImpl(client, args);
        }, canonicalKey);
      }

      // Full-league scan - no caching
      return runScreenRankedImpl(client, args);
    },

    // ─── Sharp Movement ─────────────────────────────────────────────
    async sharp_plays(args = {}) {
      const response = await runSharpPlays(args, {
        queryLeagueScreen: runLeagueScreen,
        queryTennisScreen: (rankedArgs) => runTennisScreen(rankedArgs)
      });
      // Research: when includeResearch=true (default), run player_context
      // on the top N ranked rows to attach injury/risk flags.
      const includeResearch = args.includeResearch !== undefined ? Boolean(args.includeResearch) : true;
      if (includeResearch && Array.isArray(response.result) && response.result.length) {
        const researchLimit = Number.isFinite(Number(args.researchLimit))
          ? Math.max(1, Math.min(50, Number(args.researchLimit)))
          : 10;
        const research = await runResearchOnTopRows({
          rows: response.result,
          limit: researchLimit,
          playerContextFn: handlers.player_context
        });
        response.research = research.results;
        response.resultMeta = {
          ...response.resultMeta,
          researchRunCount: research.results.length,
          researchRiskHighCount: research.results.filter((r) => r.riskFlag === 'high').length,
          researchCachedCount: research.results.filter((r) => r.cached).length
        };
        if (args.riskDowngrade === true) {
          const beforeCount = response.result.length;
          const highRiskPlayers = new Set(
            research.results.filter((r) => r.riskFlag === 'high').map((r) => String(r.player || '').toLowerCase())
          );
          response.result = response.result.filter((row) => {
            const player = String(row.selection || row.participant || '').toLowerCase();
            return !highRiskPlayers.has(player);
          });
          response.resultMeta = {
            ...response.resultMeta,
            riskDowngradedCount: beforeCount - response.result.length
          };
        }
      }
      // Apply verbosity formatting
      const verbosity = String(args.verbosity || 'full').toLowerCase();
      if (verbosity === 'minimal') return formatSharpPlaysMinimal(response);
      if (verbosity === 'standard') return formatSharpPlaysStandard(response);
      return response;
    },

    // quick_screen: Accepts any book(s) via the `books` param and runs
    // sharp_plays + player_context for each (league, market) pair.
    // Defaults to ['NoVigApp'].
    async quick_screen(args = {}) {
      const targetBooks =
        Array.isArray(args.books) && args.books.length ? args.books : args.book ? [args.book] : ['NoVigApp'];
      const leagues =
        Array.isArray(args.leagues) && args.leagues.length
          ? args.leagues
          : args.league
            ? [args.league]
            : Array.from(DEFAULT_LEAGUES);
      const markets =
        Array.isArray(args.markets) && args.markets.length ? args.markets : args.market ? [args.market] : null; // null = use per-league defaults below
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;
      const scanLimit = Number.isFinite(Number(args.scanLimit)) ? Number(args.scanLimit) : 50;
      const lookbackHours = Number.isFinite(Number(args.lookbackHours)) ? Number(args.lookbackHours) : 6;
      const includeResearch = args.includeResearch !== undefined ? Boolean(args.includeResearch) : true;
      const debug = Boolean(args.debug);

      const allAliasesUsed = [];

      const resolvedMarketsByLeague = {};
      for (const league of leagues) {
        if (markets === null) {
          // Use per-league defaults
          resolvedMarketsByLeague[league] = getDefaultMarketsForLeague(league, targetBooks);
        } else {
          const marketResolution = resolveMarkets({ markets }, league);
          resolvedMarketsByLeague[league] = marketResolution.array.length
            ? marketResolution.array
            : [marketResolution.single];
          allAliasesUsed.push(...marketResolution.aliasesUsed);
        }
      }

      const allCandidates = [];
      const researchResults = [];

      for (const league of leagues) {
        for (const market of resolvedMarketsByLeague[league] || []) {
          try {
            const spResult = await handlers.sharp_plays({
              targetBooks,
              league,
              market,
              limit: scanLimit,
              scanLimit,
              lookbackHours,
              is_live: Boolean(args.is_live),
              strict: false,
              includePasses: false,
              includeResearch: false,
              debug
            });

            const candidates = Array.isArray(spResult?.result) ? spResult.result : [];
            if (!candidates.length) continue;

            if (includeResearch) {
              const researchBatch = [];
              for (const row of candidates) {
                const player = row.selection || row.participant || row.pick;
                if (!player) continue;
                const league = String(row.league || league || '').trim();
                const game = row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`;
                researchBatch.push({ player, league, game, row });
              }

              // Run research in parallel with concurrency-3, routing by selection type
              const { runResearchOnTopRows } = require('../../lib/propprofessor-research-runner');
              const researchOpts = {
                rows: researchBatch.map((r) => ({
                  selection: r.player,
                  league: r.league,
                  game: r.game,
                  start: r.row.start || r.row.eventStart || null,
                  market: r.row.market || ''
                })),
                limit: researchBatch.length,
                playerContextFn: handlers.player_context,
                gameContextFn: (opts) =>
                  getGameContext({
                    sport: opts.sport || opts.league,
                    selection: opts.selection,
                    game: opts.game,
                    start: opts.start,
                    market: opts.market
                  }),
                concurrency: 3
              };
              const researchOut = await runResearchOnTopRows(researchOpts);
              for (const r of researchOut.results) {
                researchResults.push({
                  player: r.player,
                  game: r.game,
                  riskFlag: r.riskFlag,
                  riskSummary: r.riskSummary || null,
                  contextType: r.contextType || 'player',
                  ...(r.topTweet ? { topTweet: r.topTweet.slice(0, 120) } : {})
                });
              }
            }

            allCandidates.push({
              league,
              market,
              candidates: candidates.slice(0, limit).map((row) => ({
                playId: row.playId || null,
                selectionKey: row.selectionKey || null,
                gameId: row.gameId || null,
                game: row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`,
                selection: row.selection || row.participant || row.pick || null,
                start: row.start || null,
                odds: row.odds ?? row.currentOdds ?? null,
                edge: row.consensusEdge ?? null,
                clv: row.clvProxyPct ?? null,
                consensusBookCount: row.consensusBookCount ?? 0,
                executionQuality: row.executionQuality ?? 'unknown',
                movementGrade: row.movementGrade ?? 'unknown',
                movementLabel: row.movementLabel ?? null,
                sharpBookMovementConfirmed: row.sharpBookMovementConfirmed || false,
                sharpBookMovementSource: row.sharpBookMovementSource || null,
                riskScore: row.riskScore ?? null,
                kaiCall: row.kaiCall ?? 'PASS',
                confidenceTier: row.confidenceTier ?? 'TIER 4',
                rationale: row.rationale || null,
                screenScore: row.screenScore ?? 0,
                freshnessSource: row.freshnessSource ?? null,
                movementDisposition: row.movementDisposition || 'insufficient',
                displayTier: row.kaiCall === 'BET' ? 'BET'
                  : row.kaiCall === 'CONSIDER' ? 'CONSIDER'
                  : 'PASS',
                hoursUntilStart: row.start
                  ? Math.round((new Date(row.start).getTime() - Date.now()) / 3600000 * 10) / 10
                  : null
              }))
            });
          } catch (error) {
            const categorized = categorizeError(error);
            allCandidates.push({
              league,
              market,
              candidates: [],
              error: categorized.message,
              code: categorized.code,
              recovery: categorized.recovery
            });
          }
        }
      }

      const activeSlate = allCandidates
        .filter(r => r.candidates && r.candidates.length > 0)
        .map(r => ({
          league: r.league,
          market: r.market,
          count: r.candidates.length,
          error: r.error || null
        }));

      const warnings = allCandidates.some(r =>
        r.candidates?.some(c => c.hoursUntilStart !== null && c.hoursUntilStart < 0)
      )
        ? ['Some games have already started. Live odds may be stale.']
        : [];

      const bookList = targetBooks.length === 1 ? targetBooks[0] : targetBooks.join(', ');
      return {
        ok: true,
        targetBook: bookList,
        targetBooks,
        leagues,
        markets,
        totalCandidates: allCandidates.reduce((sum, l) => sum + (l.candidates?.length || 0), 0),
        activeSlate,
        results: allCandidates,
        research: researchResults,
        warnings,
        workflow: `${bookList} target book(s). Playable price (not necessarily best). Sharp book movement cross-referenced. Player context research included.`,
        markets_alias_used: allAliasesUsed
      };
    },

    // ─── Betting ────────────────────────────────────────────────────
    async recommended_bets(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : Array.from(DEFAULT_LEAGUES);
      // Resolve markets using aliases for each league
      const allAliasesUsed = [];
      const resolvedMarketsByLeague = {};
      for (const league of leagues) {
        if (args.markets === undefined && args.market === undefined) {
          // Use per-league defaults
          resolvedMarketsByLeague[league] = getDefaultMarketsForLeague(league);
        } else {
          const marketResolution = resolveMarkets(
            { markets: args.markets, market: args.market },
            league,
            'Moneyline' // fallback for resolveMarkets
          );
          resolvedMarketsByLeague[league] = marketResolution.array.length
            ? marketResolution.array
            : [marketResolution.single];
          allAliasesUsed.push(...marketResolution.aliasesUsed);
        }
      }
      // Use the first league's resolved markets as the default "markets" for response
      const firstLeague = leagues[0];
      const markets = resolvedMarketsByLeague[firstLeague] || ['Moneyline', 'Spread', 'Total'];
      const targetTiers =
        Array.isArray(args.targetTiers) && args.targetTiers.length ? args.targetTiers : ['TIER 1', 'TIER 2'];
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;
      // Parallelize per-league work — previously a serial for-of loop, which
      // meant 7 leagues × 3 markets = 21 sequential screen_ranked calls by
      // default. mapWithConcurrency(4) keeps the backend from being hammered
      // while cutting wall-clock latency ~60-70%.
      const allRecommended = [];
      await mapWithConcurrency(
        leagues,
        async (league) => {
          try {
            // Markets are independent per-league; fan them out under a small
            // concurrency cap. Combined with the outer league concurrency of
            // 4, peak in-flight calls sit around 4×3=12 (vs the previous
            // 4-leagues × 3-markets serial = 12 sequential per call) — but
            // the per-call wall-clock time drops to roughly max(per-call)
            // instead of sum(per-call). For 10 leagues × 3 markets that
            // cuts per-league work 3x.
            const leagueMarkets = resolvedMarketsByLeague[league] || markets;
            const marketResults = await mapWithConcurrency(
              leagueMarkets,
              async (market) => {
                const screenResult = await handlers.screen_ranked({
                  league,
                  market,
                  books: args.books,
                  limit: limit * 2,
                  is_live: Boolean(args.is_live),
                  includeAll: false,
                  debug: false,
                  compact: Boolean(args.compact),
                  fields: Array.isArray(args.fields) ? args.fields : undefined,
                  include: Array.isArray(args.include) ? args.include : undefined,
                  skipHistory: args.skipHistory === true
                });
                const rows = Array.isArray(screenResult?.result) ? screenResult.result : [];
                return rows.map((r) => ({ ...r, _market: market }));
              },
              { concurrency: 3 }
            );
            const allRows = marketResults.flat();
            // Deduplicate by gameId+selection (keep higher screenScore)
            const seen = new Map();
            for (const row of allRows) {
              const key = `${row.gameId || ''}:${row.selection || ''}`;
              const existing = seen.get(key);
              if (!existing || Number(row.screenScore ?? 0) > Number(existing.screenScore ?? 0)) {
                seen.set(key, row);
              }
            }
            const deduped = Array.from(seen.values());
            let eligible = deduped.filter((row) =>
              targetTiers.includes(row.confidenceTier || getConfidenceTierStable(row))
            );
            const recommended = eligible
              .sort((a, b) => {
                const tierOrder = { 'TIER 1': 0, 'TIER 2': 1, 'TIER 3': 2, 'TIER 4': 3 };
                const tierDiff = (tierOrder[a.confidenceTier] ?? 9) - (tierOrder[b.confidenceTier] ?? 9);
                if (tierDiff !== 0) return tierDiff;
                return (Number(b.screenScore ?? 0) || 0) - (Number(a.screenScore ?? 0) || 0);
              })
              .slice(0, limit);
            if (recommended.length) {
              // Pre-flight research (v2.1.8): when includeResearch=true, attach
              // risk flags to each play. When riskDowngrade=true, drop plays
              // with riskFlag='high' from the recommendation.
              let researchResults = [];
              let downgraded = 0;
              if ((args.includeResearch !== undefined ? Boolean(args.includeResearch) : true) && recommended.length) {
                const research = await runResearchOnTopRows({
                  rows: recommended,
                  limit: recommended.length,
                  playerContextFn: handlers.player_context
                });
                researchResults = research.results;
                if (args.riskDowngrade === true) {
                  const beforeCount = recommended.length;
                  const highRiskPlayers = new Set(
                    research.results
                      .filter((r) => r.riskFlag === 'high')
                      .map((r) => String(r.player || '').toLowerCase())
                  );
                  for (let i = recommended.length - 1; i >= 0; i -= 1) {
                    const player = String(recommended[i].selection || recommended[i].participant || '').toLowerCase();
                    if (highRiskPlayers.has(player)) {
                      recommended.splice(i, 1);
                    }
                  }
                  downgraded = beforeCount - recommended.length;
                }
              }
              allRecommended.push({
                league,
                count: recommended.length,
                markets_queried: markets,
                downgradedCount: downgraded,
                plays: recommended.map((row) => {
                  const playerName = String(row.selection || row.participant || '');
                  const research = researchResults.find(
                    (r) => String(r.player || '').toLowerCase() === playerName.toLowerCase()
                  );
                  // Resolve which book this play is executable on. If the user
                  // passed an explicit books list, use the focus book from that
                  // list (screen_ranked routes it as preferredBook). Otherwise
                  // fall back to the row's book field or oddsSource.
                  const leagueBooks = Array.isArray(args.books) && args.books.length ? args.books : [];
                  const focusBook = leagueBooks[0] || row.book || row.oddsSource || null;
                  return {
                    gameId: row.gameId || null,
                    game: row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`,
                    selection: row.selection || row.participant || null,
                    market: row._market || row.market || null,
                    start: row.start || null,
                    book: focusBook,
                    odds: row.targetBookOdds ?? null,
                    edge: row.consensusEdge,
                    clv: row.clvProxyPct,
                    consensusBookCount: row.consensusBookCount,
                    executionQuality: row.executionQuality,
                    movementGrade: row.movementGrade,
                    riskScore: row.riskScore,
                    kaiCall: row.kaiCall,
                    confidenceTier: row.confidenceTier,
                    rationale: row.rationale || buildRationale(row),
                    screenScore: row.screenScore,
                    ...(research
                      ? {
                          riskFlag: research.riskFlag,
                          riskSummary: research.riskSummary,
                          topTweet: research.topTweet
                        }
                      : {})
                  };
                })
              });
            }
          } catch (error) {
            const categorized = categorizeError(error);
            allRecommended.push({
              league,
              count: 0,
              markets_queried: markets,
              error: categorized.message,
              code: categorized.code,
              recovery: categorized.recovery
            });
          }
        },
        { concurrency: 4 }
      );
      const total = allRecommended.reduce((sum, l) => sum + (l.count || 0), 0);
      const leagueBooks = Array.isArray(args.books) && args.books.length ? args.books : [];
      const focusBook = leagueBooks[0] || null;
      const response = {
        ok: true,
        totalRecommended: total,
        focusBook,
        markets_queried: markets,
        leagues: allRecommended.filter((l) => l.count > 0),
        emptyLeagues: allRecommended.filter((l) => !l.count && !l.error).map((l) => l.league),
        failedLeagues: allRecommended.filter((l) => l.error).map((l) => ({ league: l.league, error: l.error })),
        summary: total
          ? `Found ${total} recommended bet${total === 1 ? '' : 's'} across ${allRecommended.filter((l) => l.count > 0).length} league${allRecommended.filter((l) => l.count > 0).length === 1 ? '' : 's'}`
          : 'No TIER 1 or TIER 2 plays found across requested leagues',
        tierFilter: targetTiers,
        markets_alias_used: allAliasesUsed,
        marketsBreakdown: (() => {
          const breakdown = {};
          for (const leagueData of allRecommended) {
            for (const play of leagueData.plays || []) {
              const m = play.market || 'unknown';
              breakdown[m] = (breakdown[m] || 0) + 1;
            }
          }
          return breakdown;
        })()
      };
      // Apply verbosity formatting
      const verbosity = String(args.verbosity || 'full').toLowerCase();
      if (verbosity === 'minimal') return formatRecommendedBetsMinimal(response);
      if (verbosity === 'standard') return formatRecommendedBetsStandard(response);
      return response;
    },

    async smart_bet(args = {}) {
      const selection = String(args.selection || '').trim();
      const book = String(args.book || '').trim();
      const league = String(args.league || '').trim() || undefined;
      const market = String(args.market || 'Moneyline').trim();
      const bankroll = Number.isFinite(Number(args.bankroll)) ? Number(args.bankroll) : 1000;
      const verbosity = args.verbosity || 'standard';

      if (!selection) {
        const error = new Error('selection is required');
        error.code = 'MISSING_PARAMS';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      if (!book) {
        const error = new Error('book is required');
        error.code = 'MISSING_PARAMS';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }

      // Step 1: Quick screen to find the play (skip research — validate_play does it later)
      const screenResult = await handlers.quick_screen({
        book,
        leagues: league ? [league] : undefined,
        markets: [market],
        limit: 20,
        includeResearch: false,
        verbosity: 'standard'
      });

      // Step 2: Find the matching candidate — track which league/market entry it came from
      let match = null;
      let matchLeague = league || null;
      let matchMarket = market;

      for (const entry of (screenResult.results || [])) {
        const found = (entry.candidates || []).find(c =>
          c.selection && c.selection.toLowerCase().includes(selection.toLowerCase())
        );
        if (found) {
          match = found;
          matchLeague = entry.league || matchLeague;
          matchMarket = entry.market || matchMarket;
          break;
        }
      }

      if (!match) {
        return {
          ok: true,
          found: false,
          message: `No play found for "${selection}" on ${book}. The slate may be empty or the player/team isn't in today's games.`,
          activeSlate: screenResult.activeSlate || []
        };
      }

      // Step 3: Validate the play
      let validation = null;
      try {
        validation = await handlers.validate_play({
          league: matchLeague,
          gameId: match.gameId,
          selection: match.selection,
          market: matchMarket,
          book
        });
      } catch {
        // validation failed — surface what we have
      }

      // Step 4: Line shop
      let bestPrice = null;
      try {
        bestPrice = await handlers.find_best_price({
          game: match.game,
          league: matchLeague,
          market: matchMarket,
          selection: match.selection
        });
      } catch {
        // line shop failed — not critical
      }

      // Step 5: Staking recommendation
      let staking = null;
      if (validation?.verdict === 'BET' || validation?.verdict === 'CONSIDER') {
        try {
          const stakingResult = await handlers.staking_plan({
            bankroll,
            leagues: matchLeague ? [matchLeague] : undefined,
            markets: [matchMarket],
            targetTiers: validation.verdict === 'BET' ? ['TIER 1'] : ['TIER 1', 'TIER 2']
          });
          const stakingStakes = stakingResult?.stakes || [];
          staking = stakingStakes.find(p =>
            p.selection && p.selection.toLowerCase().includes(selection.toLowerCase())
          ) || null;
        } catch {
          // staking failed — not critical
        }
      }

      return {
        ok: true,
        found: true,
        play: {
          selection: match.selection,
          game: match.game,
          league: matchLeague,
          market: matchMarket,
          odds: match.odds,
          edge: match.edge,
          executionQuality: match.executionQuality,
          movementDisposition: match.movementDisposition,
          displayTier: match.displayTier,
          kaiCall: match.kaiCall,
          confidenceTier: match.confidenceTier,
          riskScore: match.riskScore
        },
        verdict: validation ? {
          verdict: validation.verdict,
          tier: validation.tier,
          actionableSummary: validation.verdictSummary?.actionableSummary,
          riskFlags: validation.verdictSummary?.riskFlags || [],
          movementDisposition: validation.verdictSummary?.movementDisposition
        } : null,
        bestPrice: bestPrice?.found
          ? bestPrice.bestPrice
          : null,
        staking: staking ? {
          stake: staking.stakeDollars,
          stakePct: staking.bankrollPct,
          reason: staking.rationale
        } : null,
        verbosity
      };
    },

    async staking_plan(args = {}) {
      const bankroll = Number.isFinite(Number(args.bankroll)) ? Number(args.bankroll) : 1000;
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : undefined;
      const markets =
        Array.isArray(args.markets) && args.markets.length
          ? args.markets
          : args.market
            ? [args.market]
            : ['Moneyline', 'Spread', 'Total'];
      const targetTiers =
        Array.isArray(args.targetTiers) && args.targetTiers.length ? args.targetTiers : ['TIER 1', 'TIER 2'];
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;
      const recResult = await handlers.recommended_bets({
        leagues,
        markets,
        targetTiers,
        limit,
        is_live: Boolean(args.is_live),
        compact: Boolean(args.compact),
        fields: Array.isArray(args.fields) ? args.fields : undefined,
        include: Array.isArray(args.include) ? args.include : undefined,
        skipHistory: args.skipHistory === true
      });
      if (!recResult.ok || !recResult.totalRecommended) {
        return {
          ok: true,
          bankroll,
          totalStake: 0,
          playCount: 0,
          stakes: [],
          warnings: ['No recommended plays found for the given criteria'],
          summary: 'No plays to stake'
        };
      }
      const allPlays = [];
      for (const league of recResult.leagues || []) {
        for (const play of league.plays || []) {
          allPlays.push({ ...play, league: league.league });
        }
      }
      const plan = suggestStakes({ bankroll, plays: allPlays });
      return {
        ...plan,
        bankroll,
        leagueBreakdown: recResult.leagues.map((l) => ({ league: l.league, count: l.count })),
        totalRecommended: recResult.totalRecommended,
        markets_queried: recResult.markets_queried,
        markets_alias_used: recResult.markets_alias_used
      };
    },

    // ─── Player Context ─────────────────────────────────────────────
    async player_context(args = {}) {
      const player = typeof args.player === 'string' ? args.player.trim() : '';
      if (!player) {
        return { ok: false, error: 'player argument is required' };
      }
      return getPlayerContext({
        player,
        sport: typeof args.sport === 'string' && args.sport.length > 0 ? args.sport : null,
        gameTime: typeof args.gameTime === 'string' && args.gameTime.length > 0 ? args.gameTime : null,
        maxAgeMinutes: Number.isFinite(Number(args.maxAgeMinutes)) ? Number(args.maxAgeMinutes) : 60,
        useXurl: args.useXurl === true
      });
    },

    async sharp_consensus(args = {}) {
      const league = String(args.league || 'Tennis').trim();
      const marketResolution = resolveMarkets(args, league);
      const market = marketResolution.single;
      const windows =
        Array.isArray(args.windows) && args.windows.length
          ? args.windows
              .map(Number)
              .filter(Boolean)
              .sort((a, b) => a - b)
          : DEFAULT_WINDOWS;
      const sharpBooks =
        Array.isArray(args.sharpBooks) && args.sharpBooks.length
          ? args.sharpBooks.map((b) => String(b).trim()).filter(Boolean)
          : DEFAULT_SHARP_BOOKS;
      const minConsensusWindows = Number(args.minConsensusWindows) || 0;
      const lookbackHours = Number(args.lookbackHours) || 48;
      const limit = Number(args.limit) || 100;
      const rankedResponse = await handlers.screen_ranked({
        league,
        market,
        historySportsbooks: sharpBooks,
        includeAll: true,
        limit,
        lookbackHours,
        debug: false,
        is_live: Boolean(args.is_live),
        skipHistory: args.skipHistory === true
      });
      if (!rankedResponse?.ok || !Array.isArray(rankedResponse.result)) {
        return { ok: false, error: 'Failed to fetch ranked screen data' };
      }
      const rows = rankedResponse.result;
      const analysis = analyzeMultiWindow(rows, { windows, sharpBooks, minConsensusWindows, nowMs: Date.now() });
      const analysisResults = analysis.results || [];
      const summary = summarizeResults(analysisResults);
      return {
        ok: true,
        count: analysisResults.length,
        summary,
        result: analysisResults,
        resultMeta: {
          league,
          market,
          windows,
          sharpBooks,
          lookbackHours,
          totalRowsScanned: rows.length,
          minConsensusWindows,
          rowsSkippedNoHistory: analysis.skippedNoHistory || 0,
          rowsSkippedInsufficientBooks: analysis.skippedInsufficientBooks || 0,
          markets_alias_used: marketResolution.aliasesUsed
        }
      };
    },

    // ─── Screening & Ranking (continued) ────────────────────────────
    async all_slates(args = {}) {
      const leagues =
        Array.isArray(args.leagues) && args.leagues.length
          ? args.leagues.map((l) => String(l).trim()).filter(Boolean)
          : Array.from(DEFAULT_LEAGUES);
      const allAliasesUsed = [];
      const marketResolutionByLeague = {};
      for (const league of leagues) {
        const marketResolution = resolveMarkets(args, league);
        marketResolutionByLeague[league] = marketResolution.single;
        allAliasesUsed.push(...marketResolution.aliasesUsed);
      }
      // Use first league's market as default
      const market = marketResolutionByLeague[leagues[0]] || 'Moneyline';
      const limit = getLimit({ limit: args.limit || 15 });

      const results = await mapWithConcurrency(
        leagues,
        async (league) => {
          try {
            const leagueKey = league.toUpperCase();
            const resolvedMarket = marketResolutionByLeague[league] || market;
            if (leagueKey === 'TENNIS') {
              const tennisResult = await runTennisScreen({
                market: resolvedMarket,
                limit,
                includeAll: args.includeAll,
                lookbackHours: args.lookbackHours,
                is_live: Boolean(args.is_live),
                compact: Boolean(args.compact),
                fields: Array.isArray(args.fields) ? args.fields : undefined,
                include: Array.isArray(args.include) ? args.include : undefined,
                skipHistory: args.skipHistory === true
              });
              return {
                league,
                rows: tennisResult.result || [],
                meta: {
                  rowCount: (tennisResult.result || []).length,
                  source: tennisResult.source || 'screen',
                  ...(tennisResult.warnings ? { warnings: tennisResult.warnings } : {})
                }
              };
            }
            const leagueResult = await runLeagueScreen(
              {
                market,
                limit,
                includeAll: args.includeAll,
                lookbackHours: args.lookbackHours,
                is_live: Boolean(args.is_live),
                compact: Boolean(args.compact),
                fields: Array.isArray(args.fields) ? args.fields : undefined,
                include: Array.isArray(args.include) ? args.include : undefined,
                skipHistory: args.skipHistory === true
              },
              league
            );
            return {
              league,
              rows: leagueResult.result || [],
              meta: {
                rowCount: (leagueResult.result || []).length,
                source: 'screen',
                ...(leagueResult.warnings ? { warnings: leagueResult.warnings } : {})
              }
            };
          } catch (error) {
            const categorized = categorizeError(error);
            return {
              league,
              rows: [],
              meta: { rowCount: 0, source: 'error' },
              error: {
                error: categorized.message,
                code: categorized.code,
                recovery: categorized.recovery
              }
            };
          }
        },
        { concurrency: 3 }
      );

      const errors = results.filter((r) => r.error).map((r) => ({ league: r.league, ...r.error }));
      const leagueMeta = Object.fromEntries(results.map((r) => [r.league, r.meta]));
      let totalPlays = 0;
      const allRows = [];
      for (const { league, rows } of results) {
        totalPlays += rows.length;
        for (const row of rows) {
          allRows.push({ ...row, _league: league });
        }
      }
      allRows.sort((a, b) => Number(b.screenScore || 0) - Number(a.screenScore || 0));

      return {
        ok: true,
        totalPlays,
        leaguesQueried: leagues,
        leagueMeta,
        consolidated: allRows.slice(0, limit * leagues.length),
        markets_alias_used: allAliasesUsed,
        ...(errors.length > 0 ? { errors } : {})
      };
    },

    // ─── UFC ────────────────────────────────────────────────────────
    async ufc_card(args = {}) {
      return runUfcCard(args);
    },

    // ─── Play Detail & Validation Handlers ──────────────────────────────────

    async get_play_details(args = {}) {
      const canonicalKey = canonicalizeScreenArgs(args);
      if (canonicalKey) {
        return await canonicalScreenCache.memoize(async () => {
          return await runGetPlayDetailsImpl(client, args);
        }, canonicalKey)();
      }
      return runGetPlayDetailsImpl(client, args);
    },

    /**
     * mlb_game_context: pull game-level context for an MLB game.
     * Returns probable/confirmed pitchers, venue + park factor, hourly
     * weather at first pitch, and lineup lock status with a risk flag
     * for weather/park effects.
     */
    async mlb_game_context(args = {}) {
      const gamePk = String(args.gamePk || '').trim();
      if (!gamePk) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'gamePk is required' } };
      }
      if (!/^\d{4,}$/.test(gamePk)) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'gamePk must be a numeric MLB game ID' } };
      }
      try {
        const result = await getMlbGameContext({ gamePk });
        return result;
      } catch (err) {
        return { ok: false, gamePk, error: { code: 'API_ERROR', message: err?.message || String(err) } };
      }
    },

    /**
     * validate_play (v2.1.8): bundle a get_play_details + player_context +
     * execution check into a single call. Returns a single BET / CONSIDER /
     * PASS verdict with all supporting evidence so the agent doesn't have
     * to chain three separate tool calls.
     *
     * NOTE: does NOT use canonicalScreenCache. The cache's 60s TTL is
     * appropriate for screen_ranked (where the same gameId is re-fetched
     * within seconds across markets) but actively harmful for validate_play,
     * which bundles research + MLB game context that goes stale quickly.
     * Agents also call validate_play once per candidate, not N times, so
     * there's no dedup benefit worth the staleness risk.
     */
    async validate_play(args = {}) {
      return await runValidatePlayImpl(client, args);
    },

    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },

    async health_status() {
      const authFile = resolveAuthFile();
      let authState;
      try {
        authState = readAuthState(authFile);
      } catch {
        authState = null;
      }

      const authValid = isAuthValid(authState);
      const expiryInfo = getCookieExpiryInfo(authState);
      const authSection = {
        valid: authValid,
        file: authValid ? authFile : null,
        message: authValid ? 'Auth is valid' : 'Auth missing or expired. Run: pp-query login',
        session: {
          status: expiryInfo.status,
          expiresAt: expiryInfo.sessionExpiry,
          daysRemaining: expiryInfo.daysRemaining,
          warning: expiryInfo.warning
        }
      };

      if (!authValid) {
        return { ok: false, auth: authSection };
      }

      const result = await client.healthStatus();
      // Surface cache hit/miss/eviction stats so operators can verify the
      // 60s response cache and the cross-call odds-history LRU are doing
      // useful work. Without this, a misconfigured cache (TTL too short,
      // max-entries too small) would silently underperform.
      const responseCacheStats = responseCache.stats();
      const totalLooks = responseCacheStats.hits + responseCacheStats.misses;
      const responseCacheHitRate = totalLooks > 0 ? responseCacheStats.hits / totalLooks : 0;
      const oddsHistoryCacheStats = getOddsHistoryCache().stats();
      const oddsTotalLooks = oddsHistoryCacheStats.hits + oddsHistoryCacheStats.misses;
      const oddsHistoryHitRate = oddsTotalLooks > 0 ? oddsHistoryCacheStats.hits / oddsTotalLooks : 0;
      return {
        ok: true,
        auth: authSection,
        result,
        backend: {
          ok: result.ok,
          message: result.ok ? 'Backend is reachable' : 'Backend returned an error',
          ...result
        },
        caches: {
          response: {
            size: responseCacheStats.size,
            max: responseCacheStats.max,
            hits: responseCacheStats.hits,
            misses: responseCacheStats.misses,
            evictions: responseCacheStats.evictions,
            hitRate: Number(responseCacheHitRate.toFixed(4)),
            ttlMs: responseCacheTtlMs
          },
          oddsHistory: {
            size: oddsHistoryCacheStats.size,
            max: oddsHistoryCacheStats.max,
            hits: oddsHistoryCacheStats.hits,
            misses: oddsHistoryCacheStats.misses,
            evictions: oddsHistoryCacheStats.evictions,
            hitRate: Number(oddsHistoryHitRate.toFixed(4)),
            ttlMs: getOddsHistoryCacheTtlMs()
          }
        }
      };
    },

    // ─── Bet Management ─────────────────────────────────────────────
    // Consolidated from get_hidden_bets + hide_bet + unhide_bet + clear_hidden_bets
    // (4 tools → 1) in v1.6.3.
    async manage_hidden_bets(args = {}) {
      const { action } = args;
      if (action === 'list') {
        const result = await client.getHiddenBets();
        return { ok: true, action, result };
      }
      if (action === 'hide') {
        if (!args.bet || typeof args.bet !== 'object') {
          const error = new Error('The bet parameter is required and must be an object.');
          error.code = 'MISSING_BET';
          error.category = 'validation';
          error.status = 400;
          throw error;
        }
        const result = await client.hideBet(args.bet);
        return { ok: true, action, result };
      }
      if (action === 'unhide') {
        if (!args.id) {
          const error = new Error('The id parameter is required.');
          error.code = 'MISSING_ID';
          error.category = 'validation';
          error.status = 400;
          throw error;
        }
        const result = await client.unhideBet(args.id);
        return { ok: true, action, result };
      }
      if (action === 'clear') {
        const result = await client.clearHiddenBets();
        return { ok: true, action, result };
      }
      const error = new Error(`Unknown action: ${action}. Must be one of: list, hide, unhide, clear.`);
      error.code = 'INVALID_ACTION';
      error.category = 'validation';
      error.status = 400;
      throw error;
    },

    // ─── Fantasy Optimizer ──────────────────────────────────────────────
    async fantasy_optimizer(args = {}) {
      // v2.x.x: apply numeric defaults here so the upstream slipgen backend
      // doesn't KeyError on missing keys (it reads minOdds/minLegEV/minHoursAway
      // etc. directly from the body with no defaults of its own). Without
      // this, callers that omit these fields get 500s that surface as
      // "'minOdds'"/"'minLegEV'"/"'minHoursAway'" from the backend.
      const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
      const filters = {
        isLive: args.is_live !== undefined ? Boolean(args.is_live) : Boolean(args.isLive),
        showBreakOnly: args.showBreakOnly,
        showTimeoutOnly: args.showTimeoutOnly,
        showPeriodEndOnly: args.showPeriodEndOnly,
        timeAvailable: args.timeAvailable,
        userState: args.userState,
        hideNCAAPlayerProps: args.hideNCAAPlayerProps,
        fantasyApps: Array.isArray(args.fantasyApps) ? args.fantasyApps : ['PrizePicks'],
        sportsbooks: Array.isArray(args.sportsbooks)
          ? args.sportsbooks
          : ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'Pinnacle'],
        leagues: Array.isArray(args.leagues) ? args.leagues : Array.from(DEFAULT_LEAGUES),
        league: args.league,
        market: args.market,
        minOdds: num(args.minOdds, -1000),
        maxOdds: num(args.maxOdds, 1000),
        minValue: num(args.minValue, -100),
        maxValue: num(args.maxValue, 100),
        minLegEV: num(args.minLegEV, -100),
        maxLegEV: num(args.maxLegEV, 100),
        minSlipEV: num(args.minSlipEV, -100),
        maxSlipEV: num(args.maxSlipEV, 100),
        hiddenBets: Array.isArray(args.hiddenBets) ? args.hiddenBets : [],
        liveStatus: Array.isArray(args.liveStatus) ? args.liveStatus : [],
        periodTypes: Array.isArray(args.periodTypes) ? args.periodTypes : ['Full Game'],
        minHoursAway: num(args.minHoursAway, 0),
        maxHoursAway: num(args.maxHoursAway, 336),
        minLiquidity: num(args.minLiquidity, 0),
        maxLiquidity: num(args.maxLiquidity, 1000)
      };
      const result = await client.queryFantasyPicks(filters);
      return {
        ok: true,
        count: Array.isArray(result) ? result.length : 0,
        result: Array.isArray(result) ? result : []
      };
    },

    async clear_score_timeline() {
      clearScoreTimeline();
      return { ok: true, message: 'Score timeline cache cleared. Tier trajectory data reset.' };
    },

    // ─── Line Shopping ──────────────────────────────────────────────
    async find_best_price(args = {}) {
      const league = args.league || 'NBA';
      const marketResolution = resolveMarkets(args, league);
      const market = marketResolution.single;
      const payload = await client.queryScreenOddsBestComps({
        market,
        league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : undefined,
        is_live: Boolean(args.is_live)
      });
      const rows = extractScreenRows(payload);
      const result = findBestPrice(rows, { game: args.game, market, selection: args.selection, books: args.books });
      if (marketResolution.aliasesUsed.length) {
        result.markets_alias_used = marketResolution.aliasesUsed;
      }
      return result;
    },

    // ─── Meta ──────────────────────────────────────────────────────
    async ask(args = {}) {
      const query = String(args.query || '').trim();
      if (!query) {
        const error = new Error(
          'query is required. Pass a natural language bet query, e.g. "best plays on Fliff today" or "Tatum over 29.5 points".'
        );
        error.code = 'MISSING_PARAMS';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const parsed = parseNaturalLanguagePropQuery(query);

      // Check if this is a validation query ("should I bet X?") with a player
      const isValidationQuery = /\b(should i bet|is .* safe|validate|check .* play)\b/i.test(query);

      if (isValidationQuery && parsed.player) {
        return {
          ok: true,
          raw: parsed.raw,
          parsed: {
            league: parsed.league,
            book: parsed.book,
            market: parsed.market,
            side: parsed.side,
            line: parsed.line,
            player: parsed.player
          },
          suggestedTool: {
            tool: 'validate_play',
            args: {
              ...(parsed.league ? { league: parsed.league } : {}),
              selection: parsed.player,
              ...(parsed.book ? { book: parsed.book } : {})
            }
          },
          workflow: 'This looks like a validation query. Call quick_screen first to get the gameId, then call validate_play with the gameId and selection. Or if you already have a gameId from a prior call, use it directly.'
        };
      }

      return {
        ok: true,
        raw: parsed.raw,
        parsed: {
          league: parsed.league,
          book: parsed.book,
          market: parsed.market,
          side: parsed.side,
          line: parsed.line,
          player: parsed.player
        },
        suggestedTool: parsed.book
          ? {
              tool: 'quick_screen',
              args: {
                books: [parsed.book],
                ...(parsed.league ? { leagues: [parsed.league] } : {}),
                ...(parsed.market ? { markets: [parsed.market] } : {})
              }
            }
          : parsed.player
            ? {
                tool: 'player_context',
                args: { player: parsed.player, ...(parsed.league ? { sport: parsed.league } : {}) }
              }
            : {
                tool: 'recommended_bets',
                args: {
                  ...(parsed.league ? { leagues: [parsed.league] } : {}),
                  ...(parsed.market ? { markets: [parsed.market] } : {})
                }
              },
        workflow:
          'Parsed the natural language query. Call the suggested tool with the suggested args to get results back. You can also modify the args before calling — the parser is a suggestion, not a mandate.'
      };
    },

    async get_market_registry(args = {}) {
      const { getMarketsForSport } = require('../../lib/propprofessor-market-registry');
      const sport = String(args.sport || '').trim();
      const book = args.book ? String(args.book).trim() : null;
      if (!sport) {
        return { ok: false, error: { code: 'MISSING_PARAMS', message: 'sport is required' } };
      }
      const markets = getMarketsForSport(sport, book);
      return {
        ok: true,
        sport,
        book: book || 'default',
        markets,
        note:
          sport.toUpperCase() === 'SOCCER'
            ? 'Soccer uses Draw No Bet (not Moneyline), Match Handicap (not Spread), and Total Goals'
            : undefined
      };
    },

    async get_started(args = {}) {
      const userType = args.user_type || 'intermediate';

      const workflows = {
        casual: {
          summary: 'For casual bettors who just want top picks.',
          steps: [
            'Call quick_screen with verbosity="minimal" to get plain English picks — includes sharp consensus, book price, and research in one call.',
            'Present the top 3-5 plays to the user.',
            'If they want more detail on a specific play, call player_context to check injury risk.'
          ],
          tools_to_use: ['quick_screen', 'player_context'],
          avoid: ['sharp_consensus', 'ev_candidates'],
          tool_descriptions: [
            {
              name: 'quick_screen',
              one_liner: 'One-call play discovery: sharp consensus + target-book price + player research.',
              when_to_call: 'Default starting point. Use verbosity="minimal" for quick English picks.'
            },
            {
              name: 'player_context',
              one_liner: 'Injury / availability check for a specific player.',
              when_to_call: 'After quick_screen returns a play you want to validate before showing the user.'
            }
          ]
        },
        intermediate: {
          summary: 'For bettors who understand edge and tier but want guidance.',
          steps: [
            'Call quick_screen with verbosity="standard" to get structured plays with edge, tier, risk, and research — one call.',
            'If riskScore >= 7, warn the user.',
            'Filter by tier (TIER 1, TIER 2) for highest confidence.',
            'Optionally call find_best_price to line shop.',
            'For each top play, call player_context to check injury risk.'
          ],
          tools_to_use: ['quick_screen', 'player_context', 'find_best_price', 'league_presets'],
          avoid: ['sharp_consensus'],
          tool_descriptions: [
            {
              name: 'quick_screen',
              one_liner: 'One-call play discovery: sharp consensus + target-book price + player research.',
              when_to_call:
                'Default starting point. Use verbosity="standard" to get structured plays with edge, tier, risk, and research.'
            },
            {
              name: 'validate_play',
              one_liner:
                'One-call verdict with verdictSummary — agents read verdictSummary.actionableSummary instead of cross-referencing 5 fields.',
              when_to_call:
                'End-of-pipeline validation before recommending. Returns movementDisposition, riskFlags, and actionableSummary in verdictSummary.'
            },
            {
              name: 'find_best_price',
              one_liner: 'Line-shop a specific play across all books.',
              when_to_call: 'When the user has a book in mind and wants the best execution price.'
            },
            {
              name: 'player_context',
              one_liner: 'Injury / availability check.',
              when_to_call: 'When validate_play is unavailable or you want a deeper injury scan.'
            }
          ]
        },
        sharp: {
          summary: 'For sharp bettors who want full control and movement data.',
          steps: [
            'Call quick_screen with verbosity="full" to get complete data — edge, tier, risk, line history, and research all at once.',
            'Use sharp_consensus to check multi-window movement.',
            'Use sharp_plays to find plays with independent sharp support.',
            'Call get_play_details for line history on specific plays.',
            'Use staking_plan for Kelly sizing.',
            'Check player_context for injury risk on final picks.'
          ],
          tools_to_use: [
            'quick_screen',
            'sharp_consensus',
            'sharp_plays',
            'get_play_details',
            'staking_plan',
            'player_context',
            'find_best_price'
          ],
          avoid: [],
          tool_descriptions: [
            {
              name: 'quick_screen',
              one_liner: 'One-call play discovery: sharp consensus + target-book price + player research.',
              when_to_call:
                'Default starting point. Use verbosity="full" for complete edge, tier, risk, line history, and research in one call.'
            },
            {
              name: 'all_slates',
              one_liner: 'Multi-league ranked consolidation.',
              when_to_call: 'Daily discovery. Use instead of looping screen_ranked over each league.'
            },
            {
              name: 'sharp_plays',
              one_liner: 'Plays with independent sharp confirmation across Pinnacle/Circa/BookMaker/BetOnline.',
              when_to_call: 'When the user wants the highest-conviction multi-sharp plays only.'
            },
            {
              name: 'sharp_consensus',
              one_liner: 'Multi-window (1h-48h) sharp movement analysis.',
              when_to_call: 'When you need to see whether a move is sustained or just a one-off.'
            },
            {
              name: 'get_play_details',
              one_liner: 'Line history for a specific game.',
              when_to_call: 'When you have a gameId and need the full odds trail.'
            },
            {
              name: 'validate_play',
              one_liner:
                'One-call verdict with verdictSummary — agents read verdictSummary.actionableSummary instead of cross-referencing 5 fields.',
              when_to_call:
                'End-of-pipeline validation. Returns movementDisposition, riskFlags, and actionableSummary in verdictSummary.'
            },
            {
              name: 'staking_plan',
              one_liner: 'Kelly-sized stake allocations.',
              when_to_call: 'After the user has decided which plays to take. Returns per-play dollar stakes.'
            },
            {
              name: 'player_context',
              one_liner: 'Injury / availability check.',
              when_to_call: 'Final pre-flight before any bet recommendation.'
            }
          ]
        }
      };

      const workflow = workflows[userType] || workflows.intermediate;
      // Always include a top-level reminder of the honest-scope caveat so an
      // agent that ONLY reads get_started (and skips individual tool
      // descriptions) still sees it. Tier and kaiCall are signal-quality
      // ratings, not win-probability predictions.
      return {
        ...workflow,
        honest_scope:
          'TIER 1-4, kaiCall (BET/CONSIDER/PASS), edge, and screenScore are quality ratings on what sharp books are doing — NOT predictions about which side will win. TIER 1 means sharp books agree; it does not mean the side will win. Use to inform handicapping, not to outsource decisions.',
        edge_cases: [
          'validate_play_no_match: If validate_play returns lookupStatus="lookup_failed" with verdict CONSIDER, the screen row could not be rehydrated — this is a stale snapshot, not a negative signal. Pass playId from the prior quick_screen call for exact matching. Do NOT treat this as PASS.',
          'soccer_markets: quick_screen with leagues=["Soccer"] uses Draw No Bet / Match Handicap / Total Goals by default. If you get 0 results, the book may genuinely not have soccer that day. Probe find_best_price with market="Draw No Bet" on a known fixture.',
          'tennis_start_time: validate_play may return stale start timestamps for tennis. Check verdictSummary.movementDisposition and gameContext — if surface/level resolve to a real tournament, the match is live regardless of the API start time.',
          'movement_disposition: validate_play.verdictSummary.movementDisposition is the single field to check: supportive_clean = BET, supportive_bouncy = CONSIDER, adverse_recent/adverse_full = PASS. Do not cross-reference movementGrade + movementLabel separately.',
          'empty_slate: If quick_screen returns 0 candidates across all leagues, run health_status first. If auth is valid, the slate is genuinely empty. Do not force recommendations.'
        ]
      };
    },

    // ─── Picks ─────────────────────────────────────────────────────
    async log_pick(args = {}) {
      if (!args.game || !args.league || !args.market || !args.selection || !Number.isFinite(args.odds)) {
        const error = new Error('game, league, market, selection, and odds are required');
        error.code = 'VALIDATION_ERROR';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      return logPick(args.game, args.league, args.market, args.selection, args.odds, {
        stake: args.stake,
        confidenceTier: args.confidenceTier,
        kaiCall: args.kaiCall,
        rationale: args.rationale,
        notes: args.notes
      });
    },

    async get_pick_history(args = {}) {
      return getPickHistory({
        status: args.status,
        league: args.league,
        days: args.days,
        limit: args.limit
      });
    },

    async resolve_pick(args = {}) {
      if (!args.id || !args.result) {
        const error = new Error('id and result are required');
        error.code = 'VALIDATION_ERROR';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      return resolvePick(args.id, args.result);
    },

    async get_pick_stats(args = {}) {
      return getPickStats({ days: args.days });
    },

    // ─── Alerts ─────────────────────────────────────────────────────
    async get_alerts(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : Array.from(DEFAULT_LEAGUES);
      const lookbackHours = Number.isFinite(Number(args.lookbackHours))
        ? Math.min(48, Math.max(1, Number(args.lookbackHours)))
        : 6;
      const minSteamBooks = Number.isFinite(Number(args.minSteamBooks))
        ? Math.min(5, Math.max(1, Number(args.minSteamBooks)))
        : 2;

      const checkpoint = readCheckpoint();
      const now = new Date().toISOString();
      const alerts = [];

      for (const league of leagues) {
        try {
          const screenResult = await handlers.screen_ranked({
            league,
            market: 'Moneyline',
            limit: 20,
            includeAll: true,
            debug: false,
            compact: true,
            skipHistory: false,
            lookbackHours,
            is_live: false
          });

          const rows = Array.isArray(screenResult?.result) ? screenResult.result : [];
          if (!rows.length) continue;

          const lastChecked = checkpoint.leagues[league];
          const lastCheckedMs = lastChecked ? new Date(lastChecked).getTime() : 0;

          // Steam moves (strict rule: 3+ books, 5-min window)
          const steamMoves = rows.filter((r) => r.steamMove && r.steamBookCount >= minSteamBooks);
          if (steamMoves.length) {
            alerts.push({
              type: 'steam_move',
              league,
              count: steamMoves.length,
              examples: steamMoves.slice(0, 3).map((r) => ({
                game: r.game || `${r.awayTeam || '?'} @ ${r.homeTeam || '?'}`,
                selection: r.selection || r.participant,
                market: r.screenMarket || r.market,
                direction: r.steamDirection,
                books: r.steamBooks,
                bookCount: r.steamBookCount
              }))
            });
          }

          // Significant CLV shifts (>= 2% CLV proxy)
          const clvShifts = rows.filter((r) => Number.isFinite(r.clvProxyPct) && Math.abs(r.clvProxyPct) >= 2);
          if (clvShifts.length) {
            alerts.push({
              type: 'clv_shift',
              league,
              count: clvShifts.length,
              examples: clvShifts.slice(0, 3).map((r) => ({
                game: r.game || `${r.awayTeam || '?'} @ ${r.homeTeam || '?'}`,
                selection: r.selection || r.participant,
                market: r.screenMarket || r.market,
                clvPct: r.clvProxyPct,
                direction: r.clvProxyPct > 0 ? 'supportive' : 'adverse'
              }))
            });
          }

          // New TIER 1 / TIER 2 plays
          const newPlays = rows.filter((r) => {
            if (!lastCheckedMs) return false;
            const rowTime = r.freshnessMs || 0;
            return rowTime > lastCheckedMs && (r.confidenceTier === 'TIER 1' || r.confidenceTier === 'TIER 2');
          });
          if (newPlays.length) {
            alerts.push({
              type: 'new_play',
              league,
              count: newPlays.length,
              examples: newPlays.slice(0, 5).map((r) => ({
                game: r.game || `${r.awayTeam || '?'} @ ${r.homeTeam || '?'}`,
                selection: r.selection || r.participant,
                tier: r.confidenceTier,
                edge: r.consensusEdge,
                clv: r.clvProxyPct
              }))
            });
          }
        } catch {
          // League failed to scan — skip, continue with others
        }
      }

      // Update checkpoint
      const updatedLeagues = {};
      for (const league of leagues) {
        updatedLeagues[league] = now;
      }
      writeCheckpoint({ lastCheckedAt: now, leagues: { ...checkpoint.leagues, ...updatedLeagues } });

      return {
        ok: true,
        totalAlerts: alerts.length,
        alerts,
        leaguesChecked: leagues,
        lastCheckedAt: now
      };
    }
  };

  return handlers;
}

module.exports = { createMcpHandlers, mapWithConcurrency };
