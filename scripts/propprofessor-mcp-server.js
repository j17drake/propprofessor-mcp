#!/usr/bin/env node
'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const {
  normalizeTennisMarketQuery,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  extractScreenRows,
  enrichTennisEvCandidates,
  isTennisRow
} = require('../lib/propprofessor-screen-utils');
const { buildUfcShortlist } = require('../lib/propprofessor-sharp-plays');
const { findBestPrice } = require('../lib/propprofessor-best-price');
const { detectSteamMove } = require('../lib/propprofessor-steam-move');
const {
  buildRankedScreenResponse: buildRankedScreenResponseShared,
  getIncludeAll,
  getLeagueRankingPreset,
  getLimit,
  getLookbackHours,
  getMaxAgeMs,
  normalizeBookList,
  getDebugFlag
} = require('../lib/propprofessor-mcp-ranked-screen');
const { getSharpBookComparisonSet, getSharpBookContext, ALL_SCREEN_BOOKS } = require('../lib/propprofessor-sharp-books');
const { resolveHistoryForEntity } = require('../lib/propprofessor-history');
const {
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
} = require('../lib/propprofessor-mcp-stdio');
const { buildToolDefinitions } = require('../lib/propprofessor-tool-definitions');
const { runSharpPlays } = require('../lib/propprofessor-sharp-plays-service');
const { correctTennisTimes } = require('../lib/propprofessor-tennis-times');
const { analyzeMultiWindow, summarizeResults, DEFAULT_WINDOWS, DEFAULT_SHARP_BOOKS } = require('../lib/propprofessor-sharp-consensus');
const { getConfidenceTier, buildRationale, suggestStakes } = require('../lib/propprofessor-risk-score');

const SERVER_NAME = 'propprofessor';
const SERVER_VERSION = require('../package.json').version;
const PROTOCOL_VERSION = '2024-11-05';
const VALIDATED_EV_CONCURRENCY = 6;

// Strip undefined values so they don't override API client defaults via spread
function defined(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// ALL_SCREEN_BOOKS is imported from propprofessor-sharp-books.js

async function mapWithConcurrency(items, worker, { concurrency = VALIDATED_EV_CONCURRENCY } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runWorker()));
  return results;
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
  const cache = new Map();
  return async function queryHistoryMemoized(params = {}) {
    const sportsbooks = Array.isArray(params.sportsbooks)
      ? params.sportsbooks.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const cacheKey = JSON.stringify({
      gameId: params.gameId ?? null,
      selectionId: params.selectionId ?? null,
      sportsbooks,
      startTimestamp: params.startTimestamp ?? null
    });
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        Promise.resolve().then(() =>
          client.queryOddsHistory({
            ...params,
            sportsbooks
          })
        )
      );
    }
    return cache.get(cacheKey);
  };
}

async function validatePositiveEvCandidates({ client, candidates = [], args = {} } = {}) {
  const rows = Array.isArray(candidates) ? candidates.filter((play) => play && typeof play === 'object') : [];
  const requestedBooks = normalizeBookList(args.books);
  const limit = getLimit(args);
  const debug = getDebugFlag(args.debug, true);
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
    freshness: require('../lib/propprofessor-screen-utils').summarizeFreshness(
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
  async function runLeagueScreen(args = {}, league) {
    const requestedBooks = normalizeBookList(args.books);
    const market = args.market || 'Moneyline';
    const preset = getLeagueRankingPreset(league, market);
    const focusBook = requestedBooks[0] || preset.preferredBooks[0];
    const payload = await client.queryScreenOddsBestComps({
      market,
      league,
      games: Array.isArray(args.games) ? args.games : [],
      participants: Array.isArray(args.participants) ? args.participants : [],
      books: requestedBooks,
      is_live: Boolean(args.is_live)
    });
    return buildRankedScreenResponseShared({
      client,
      payloads: [payload],
      args,
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
          debug
        })
    });
  }

  async function runSportScreen(args = {}) {
    const requestedLeague = String(args.league || '').trim();
    if (!requestedLeague) {
      throw new Error('league is required');
    }
    const presetLeague = getLeagueRankingPreset(requestedLeague).league;
    return presetLeague === 'TENNIS'
      ? handlers.query_tennis_screen(args)
      : runLeagueScreen(args, presetLeague || requestedLeague);
  }

  async function runUfcCard(args = {}) {
    const normalizedMarkets = Array.isArray(args.markets)
      ? args.markets.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const market = normalizedMarkets[0] || String(args.market || 'Moneyline').trim() || 'Moneyline';
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
        shortlist: {
          ...shortlist,
          count
        }
      }
    };
  }
  const handlers = {
    async query_positive_ev_candidates(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length
        ? args.leagues
        : undefined;
      if (!leagues) {
        const error = new Error(
          'The leagues parameter is required on query_positive_ev_candidates. ' +
          'Pass one or more league names, e.g. leagues: ["NBA", "MLB", "Tennis"]. ' +
          'An empty array or omitted leagues will cause the backend to return HTTP 400.'
        );
        error.code = 'MISSING_LEAGUES';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const payload = await client.querySportsbook(defined({
        isLive: args.isLive,
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
        weightSettings: args.weightSettings && typeof args.weightSettings === 'object' ? args.weightSettings : undefined
      }));
      const rows = Array.isArray(payload) ? payload : [];
      return {
        ok: true,
        count: rows.length,
        result: rows,
        notes: {
          workflow:
            'Use these rows as fast discovery candidates, then validate finalists with /screen, exact-line checks, and sharp-book movement.',
          minValueBehavior: args.minValue === undefined ? 'unset_here_use_frontend_filter' : 'explicit_request_override'
        }
      };
    },

    async query_validated_positive_ev_candidates(args = {}) {
      const discovery = await handlers.query_positive_ev_candidates(args);
      return validatePositiveEvCandidates({
        client,
        candidates: discovery.result,
        args
      });
    },

    async query_screen_odds(args = {}) {
      const payload = await client.queryScreenOdds({
        market: args.market || 'Moneyline',
        league: args.league || 'NBA',
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : [],
        is_live: Boolean(args.is_live)
      });
      return { ok: true, result: payload };
    },

    async query_screen_odds_best_comps(args = {}) {
      const payload = await client.queryScreenOddsBestComps({
        market: args.market,
        league: args.league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : undefined,
        is_live: Boolean(args.is_live)
      });
      return {
        ok: true,
        result: payload,
        comparisonBooks: getSharpBookComparisonSet({
          league: args.league || 'NBA',
          market: args.market,
          requestedBooks: Array.isArray(args.books) ? args.books : undefined
        }),
        sharpBookResearch: getSharpBookContext({ league: args.league || 'NBA', market: args.market })
      };
    },
    async query_screen_odds_ranked(args = {}) {
      const requestedBooks = normalizeBookList(args.books);
      const league = args.league || 'NBA';
      const market = args.market || 'Moneyline';
      const preset = getLeagueRankingPreset(league, market);
      const focusBook = requestedBooks[0] || preset.preferredBooks[0];
      const payload = await client.queryScreenOddsBestComps({
        market,
        league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: requestedBooks,
        is_live: Boolean(args.is_live)
      });
      return buildRankedScreenResponseShared({
        client,
        payloads: [payload],
        args,
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
            debug
          })
      });
    },
    async query_sport_screen(args = {}) {
      return runSportScreen(args);
    },
    async query_sharp_plays(args = {}) {
      return runSharpPlays(args, {
        queryLeagueScreen: runLeagueScreen,
        queryTennisScreen: (rankedArgs) => handlers.query_tennis_screen(rankedArgs)
      });
    },
    async query_recommended_bets(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length
        ? args.leagues
        : ['NBA', 'WNBA', 'MLB', 'NHL', 'Tennis', 'UFC', 'SOCCER'];
      const market = args.market || 'Moneyline';
      const targetTiers = Array.isArray(args.targetTiers) && args.targetTiers.length
        ? args.targetTiers
        : ['TIER 1', 'TIER 2'];
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;

      const allRecommended = [];

      for (const league of leagues) {
        try {
          const screenResult = await handlers.query_screen_odds_ranked({
            league,
            market,
            books: args.books,
            limit: limit * 2,
            is_live: Boolean(args.is_live),
            includeAll: false,
            debug: false
          });

          const rows = Array.isArray(screenResult?.result) ? screenResult.result : [];
          const recommended = rows
            .filter((row) => {
              const tier = getConfidenceTier(row);
              return targetTiers.includes(tier);
            })
            .sort((a, b) => {
              const tierOrder = { 'TIER 1': 0, 'TIER 2': 1, 'TIER 3': 2, 'TIER 4': 3 };
              const tierDiff = (tierOrder[a.confidenceTier] ?? 9) - (tierOrder[b.confidenceTier] ?? 9);
              if (tierDiff !== 0) return tierDiff;
              return (Number(b.screenScore ?? 0) || 0) - (Number(a.screenScore ?? 0) || 0);
            })
            .slice(0, limit);

          if (recommended.length) {
            allRecommended.push({
              league,
              market,
              count: recommended.length,
              plays: recommended.map((row) => ({
                game: row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`,
                selection: row.selection || row.participant || null,
                start: row.start || null,
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
                screenScore: row.screenScore
              }))
            });
          }
        } catch (error) {
          allRecommended.push({ league, market, count: 0, error: String(error.message || error) });
        }
      }

      const total = allRecommended.reduce((sum, l) => sum + (l.count || 0), 0);
      return {
        ok: true,
        totalRecommended: total,
        leagues: allRecommended.filter((l) => l.count > 0),
        emptyLeagues: allRecommended.filter((l) => !l.count && !l.error).map((l) => l.league),
        failedLeagues: allRecommended.filter((l) => l.error).map((l) => ({ league: l.league, error: l.error })),
        summary: total
          ? `Found ${total} recommended bet${total === 1 ? '' : 's'} across ${allRecommended.filter((l) => l.count > 0).length} league${allRecommended.filter((l) => l.count > 0).length === 1 ? '' : 's'}`
          : 'No TIER 1 or TIER 2 plays found across requested leagues',
        tierFilter: targetTiers
      };
    },
    async query_staking_plan(args = {}) {
      const bankroll = Number.isFinite(Number(args.bankroll)) ? Number(args.bankroll) : 1000;
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : undefined;
      const market = args.market || 'Moneyline';
      const targetTiers = Array.isArray(args.targetTiers) && args.targetTiers.length
        ? args.targetTiers
        : ['TIER 1', 'TIER 2'];
      const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 10;

      // Get recommended plays
      const recResult = await handlers.query_recommended_bets({ leagues, market, targetTiers, limit, is_live: Boolean(args.is_live) });
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

      // Flatten plays from all leagues
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
        totalRecommended: recResult.totalRecommended
      };
    },
    async find_best_price(args = {}) {
      const league = args.league || 'NBA';
      const market = args.market || 'Moneyline';
      const payload = await client.queryScreenOddsBestComps({
        market,
        league,
        games: Array.isArray(args.games) ? args.games : [],
        participants: Array.isArray(args.participants) ? args.participants : [],
        books: Array.isArray(args.books) ? args.books : undefined,
        is_live: Boolean(args.is_live)
      });
      const rows = extractScreenRows(payload);
      return findBestPrice(rows, {
        game: args.game,
        market,
        selection: args.selection,
        books: args.books
      });
    },
    async query_nba_screen(args = {}) {
      return runLeagueScreen(args, 'NBA');
    },
    async query_wnba_screen(args = {}) {
      return runLeagueScreen(args, 'WNBA');
    },
    async query_mlb_screen(args = {}) {
      return runLeagueScreen(args, 'MLB');
    },
    async query_nfl_screen(args = {}) {
      return runLeagueScreen(args, 'NFL');
    },
    async query_nhl_screen(args = {}) {
      return runLeagueScreen(args, 'NHL');
    },
    async query_ufc_screen(args = {}) {
      return runLeagueScreen(args, 'UFC');
    },
    async query_ufc_card(args = {}) {
      return runUfcCard(args);
    },
    async query_soccer_screen(args = {}) {
      return runLeagueScreen(args, 'Soccer');
    },
    async query_ncaab_screen(args = {}) {
      return runLeagueScreen(args, 'NCAAB');
    },
    async query_ncaaf_screen(args = {}) {
      return runLeagueScreen(args, 'NCAAF');
    },
    async query_tennis_screen(args = {}) {
      const preferredBook = String(args.book || 'Pinnacle').trim() || 'Pinnacle';
      const requestedBooks = normalizeBookList(args.books);
      const marketQuery = normalizeTennisMarketQuery(args.market || 'Moneyline');
      const queryFn =
        typeof client.queryScreenOdds === 'function'
          ? client.queryScreenOdds.bind(client)
          : client.queryScreenOddsBestComps.bind(client);

      // Phase 1: Try /screen (existing behavior)
      const payloads = [];
      for (const market of marketQuery) {
        const payload = await queryFn({
          market,
          league: 'Tennis',
          books: requestedBooks.length
            ? requestedBooks
            : ALL_SCREEN_BOOKS,
          is_live: Boolean(args.is_live)
        });
        payloads.push(payload);
      }

      const rows = payloads.flatMap(payload => extractScreenRows(payload));

      // Check if /screen returned actionable data (not just Polymarket-only)
      const hasScreenBooks = rows.some(row => {
        const text = JSON.stringify(row || '');
        return text.includes('"Pinnacle"') || text.includes('"Circa"') || text.includes('"BetOnline"') || text.includes('"Kalshi"');
      });
      const hasScreenConsensus = rows.some(row => {
        const text = JSON.stringify(row || '');
        return text.includes('"consensus"') || text.includes('"ev"') || text.includes('"value"');
      });

      if (hasScreenBooks || hasScreenConsensus) {
        // /screen has real data -- use existing ranking
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
              debug
            })
        });
        // Correct tennis match times via SportScore
        if (screenResult?.result) {
          screenResult.result = await correctTennisTimes(screenResult.result);
        }
        return screenResult;
      }

      // Phase 2: /screen returned only Polymarket odds -- fall back to +EV endpoint
      let evResult;
      try {
        evResult = await client.querySportsbook({
          leagues: ['Tennis'],
          sportsbooks: ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'Pinnacle', 'Polymarket', 'Circa', 'BetOnline', 'Kalshi', 'NoVigApp'],
          minOdds: -9999,
          maxOdds: 9999,
          minValue: 0,
          maxHoursAway: 48,
          isLive: Boolean(args.is_live)
        });
      } catch {
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
        ? evResult.filter(row => String(row.league || '').toLowerCase() === 'tennis')
        : [];

      if (!evCandidates.length) {
        return {
          ok: true,
          result: [],
          league: 'Tennis',
          resultMeta: { debugEnabled: false, source: 'fallback_empty' },
          freshness: { rowCount: rows.length, newestAgeMs: 0, oldestAgeMs: 0, staleCount: 0, stale: false },
          warning: '/screen returned only Polymarket odds and +EV endpoint has no tennis candidates today'
        };
      }

      // Enrich +EV candidates with odds history and rank them
      const ranked = await enrichTennisEvCandidates(evCandidates, client, {
        preferredBook,
        limit: getLimit(args),
        lookbackHours: getLookbackHours(args)
      });

      // Correct tennis match times via SportScore
      const correctedRanked = await correctTennisTimes(ranked);

      return {
        ok: true,
        result: correctedRanked,
        league: 'Tennis',
        freshness: { rowCount: rows.length, newestAgeMs: 0, oldestAgeMs: 0, staleCount: 0, stale: false },
        source: '+ev_enriched',
        note: '/screen returned insufficient tennis data; results enriched from +EV endpoint with odds history'
      };
    },

    async query_sharp_consensus_windows(args = {}) {
      const league = String(args.league || 'Tennis').trim();
      const market = String(args.market || 'Moneyline').trim();
      const windows = Array.isArray(args.windows) && args.windows.length
        ? args.windows.map(Number).filter(Boolean).sort((a, b) => a - b)
        : DEFAULT_WINDOWS;
      const sharpBooks = Array.isArray(args.sharpBooks) && args.sharpBooks.length
        ? args.sharpBooks.map((b) => String(b).trim()).filter(Boolean)
        : DEFAULT_SHARP_BOOKS;
      const minConsensusWindows = Number(args.minConsensusWindows) || 0;
      const lookbackHours = Number(args.lookbackHours) || 48;
      const limit = Number(args.limit) || 100;

      // Fetch ranked screen data with wide lookback.
      // Do NOT pass `books` here -- the backend only returns multi-book data
      // for non-major leagues when the full book list is passed. Instead, pass
      // `historySportsbooks` so the history enrichment targets the sharp books
      // we need for consensus analysis.
      const rankedResponse = await handlers.query_screen_odds_ranked({
        league,
        market,
        historySportsbooks: sharpBooks,
        includeAll: true,
        limit,
        lookbackHours,
        debug: false,
        is_live: Boolean(args.is_live)
      });

      if (!rankedResponse?.ok || !Array.isArray(rankedResponse.result)) {
        return { ok: false, error: 'Failed to fetch ranked screen data' };
      }

      const rows = rankedResponse.result;
      const analysis = analyzeMultiWindow(rows, {
        windows,
        sharpBooks,
        minConsensusWindows,
        nowMs: Date.now()
      });
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
          rowsSkippedInsufficientBooks: analysis.skippedInsufficientBooks || 0
        }
      };
    },

    async query_all_slates(args = {}) {
      const DEFAULT_LEAGUES = ['NBA', 'MLB', 'NHL', 'TENNIS', 'WNBA', 'Soccer', 'UFC'];
      const leagues = Array.isArray(args.leagues) && args.leagues.length
        ? args.leagues.map((l) => String(l).trim()).filter(Boolean)
        : DEFAULT_LEAGUES;
      const market = args.market || 'Moneyline';
      const limit = getLimit({ limit: args.limit || 15 });

      const results = {};
      const leagueMeta = {};
      let totalPlays = 0;
      const errors = [];

      for (const league of leagues) {
        try {
          if (league.toUpperCase() === 'TENNIS') {
            const tennisResult = await handlers.query_tennis_screen({
              market,
              limit,
              includeAll: args.includeAll,
              lookbackHours: args.lookbackHours,
              is_live: Boolean(args.is_live)
            });
            results[league] = tennisResult.result || [];
            leagueMeta[league] = {
              rowCount: results[league].length,
              source: tennisResult.source || 'screen',
              ...(tennisResult.warnings ? { warnings: tennisResult.warnings } : {})
            };
            totalPlays += results[league].length;
          } else if (league.toUpperCase() === 'UFC') {
            const ufcResult = await runLeagueScreen(
              { market, limit, includeAll: args.includeAll, lookbackHours: args.lookbackHours, is_live: Boolean(args.is_live) },
              'UFC'
            );
            results[league] = ufcResult.result || [];
            leagueMeta[league] = {
              rowCount: results[league].length,
              source: 'screen'
            };
            totalPlays += results[league].length;
          } else {
            const leagueResult = await runLeagueScreen(
              { market, limit, includeAll: args.includeAll, lookbackHours: args.lookbackHours, is_live: Boolean(args.is_live) },
              league
            );
            results[league] = leagueResult.result || [];
            leagueMeta[league] = {
              rowCount: results[league].length,
              source: 'screen',
              ...(leagueResult.warnings ? { warnings: leagueResult.warnings } : {})
            };
            totalPlays += results[league].length;
          }
        } catch (error) {
          errors.push({ league, error: error.message || String(error) });
          results[league] = [];
          leagueMeta[league] = { rowCount: 0, source: 'error' };
        }
      }

      // Build a consolidated ranked list across all leagues
      const allRows = [];
      for (const [league, rows] of Object.entries(results)) {
        for (const row of rows) {
          allRows.push({ ...row, _league: league });
        }
      }
      // Sort by screen score descending across all leagues
      allRows.sort((a, b) => Number(b.screenScore || 0) - Number(a.screenScore || 0));

      return {
        ok: true,
        totalPlays,
        leaguesQueried: leagues,
        leagueMeta,
        consolidated: allRows.slice(0, limit * leagues.length),
        ...(errors.length > 0 ? { errors } : {})
      };
    },
    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },
    async health_status() {
      const result = await client.healthStatus();
      return { ok: true, result };
    },
    async get_hidden_bets() {
      const result = await client.getHiddenBets();
      return { ok: true, result };
    },
    async hide_bet(args = {}) {
      if (!args.bet || typeof args.bet !== 'object') {
        const error = new Error('The bet parameter is required and must be an object.');
        error.code = 'MISSING_BET';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const result = await client.hideBet(args.bet);
      return { ok: true, result };
    },
    async unhide_bet(args = {}) {
      if (!args.id) {
        const error = new Error('The id parameter is required.');
        error.code = 'MISSING_ID';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const result = await client.unhideBet(args.id);
      return { ok: true, result };
    },
    async clear_hidden_bets() {
      const result = await client.clearHiddenBets();
      return { ok: true, result };
    }
  };

  return handlers;
}

function createMcpServer({ handlers = createMcpHandlers(), toolDefinitions = buildToolDefinitions() } = {}) {
  const toolMap = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  let initialized = false;

  async function handleRequest(message) {
    const { id = null, method, params } = message || {};

    if (method === 'initialize') {
      initialized = true;
      return createJsonRpcSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'notifications/cancelled') {
      return null;
    }

    if (method === 'ping') {
      return createJsonRpcSuccess(id, {});
    }

    if (!initialized) {
      return createJsonRpcError(id, -32002, 'Server not initialized');
    }

    if (method === 'tools/list') {
      return createJsonRpcSuccess(id, { tools: toolDefinitions });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const handler = handlers[toolName];
      if (!toolMap.has(toolName) || typeof handler !== 'function') {
        return createJsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
      try {
        const result = await handler(params?.arguments || {});
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        });
      } catch (error) {
        const categorized = categorizeError(error);
        const debugMode = params?.arguments?.debug === true;
        const failure = {
          ok: false,
          error: {
            code: categorized.code,
            message: categorized.message,
            category: categorized.category,
            status: categorized.status,
            ...(debugMode ? {
              stack: error.stack || null,
              originalMessage: error.message,
              cause: error.cause ? error.cause.message || String(error.cause) : null
            } : {})
          }
        };
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          structuredContent: failure,
          isError: true
        });
      }
    }

    return createJsonRpcError(id, -32601, `Method not found: ${method}`);
  }

  return {
    async handleRequest(message) {
      return handleRequest(message);
    },
    toolDefinitions
  };
}

async function serveStdio(options = {}) {
  const server = createMcpServer(options);
  const reader = createStdioMessageReader(async (message) => {
    const response = await server.handleRequest(message);
    if (response && message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      process.stdout.write(encodeMessage(response));
    }
  });

  process.stdin.on('data', (chunk) => {
    Promise.resolve()
      .then(() => reader(chunk))
      .catch((error) => {
        process.stderr.write((error.stack || error.message || String(error)) + '\n');
      });
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  process.stdin.resume();
}

if (require.main === module) {
  serveStdio().catch((err) => {
    process.stderr.write((err.stack || err.message) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  buildToolDefinitions,
  createMcpHandlers,
  createMcpServer,
  createStdioMessageReader,
  encodeMessage,
  mapWithConcurrency,
  serveStdio
};
