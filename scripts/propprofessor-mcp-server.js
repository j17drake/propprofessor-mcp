#!/usr/bin/env node
'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const {
  normalizeTennisMarketQuery,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  extractScreenRows
} = require('../lib/propprofessor-screen-utils');
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
const { getSharpBookComparisonSet, getSharpBookContext } = require('../lib/propprofessor-sharp-books');
const { resolveHistoryForEntity } = require('../lib/propprofessor-history');
const {
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
} = require('../lib/propprofessor-mcp-stdio');
const { buildToolDefinitions } = require('../lib/propprofessor-tool-definitions');

const SERVER_NAME = 'propprofessor';
const SERVER_VERSION = require('../package.json').version;
const PROTOCOL_VERSION = '2024-11-05';
const VALIDATED_EV_CONCURRENCY = 6;

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
  const leagues = ['NBA', 'WNBA', 'MLB', 'NFL', 'NHL', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
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

  const handlers = {
    async query_positive_ev_candidates(args = {}) {
      const payload = await client.querySportsbook({
        isLive: args.isLive,
        showBreakOnly: args.showBreakOnly,
        showTimeoutOnly: args.showTimeoutOnly,
        showPeriodEndOnly: args.showPeriodEndOnly,
        timeAvailable: args.timeAvailable,
        userState: args.userState,
        hideNCAAPlayerProps: args.hideNCAAPlayerProps,
        sportsbooks: Array.isArray(args.sportsbooks) ? args.sportsbooks : undefined,
        leagues: Array.isArray(args.leagues) ? args.leagues : undefined,
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
      });
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
      const payloads = [];

      for (const market of marketQuery) {
        const payload = await queryFn({
          market,
          league: 'Tennis',
          books: requestedBooks.length
            ? requestedBooks
            : Array.from(new Set([preferredBook, 'NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'])),
          is_live: Boolean(args.is_live)
        });
        payloads.push(payload);
      }

      return buildRankedScreenResponseShared({
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
    },

    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },
    async health_status() {
      const result = await client.healthStatus();
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
        const failure = {
          ok: false,
          error: {
            code: categorized.code,
            message: categorized.message,
            category: categorized.category,
            status: categorized.status
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
