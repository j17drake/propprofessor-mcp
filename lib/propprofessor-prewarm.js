'use strict';

const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');
const { mapWithConcurrency } = require('./propprofessor-shared-utils');

/** Max number of leagues to process concurrently during prewarm. */
const MAX_CONCURRENT_LEAGUES = 3;

/**
 * Process a single league: fetch screen data, then fetch odds history for each game.
 * The game history calls are sequential within the league.
 *
 * @param {Object} options - Options object.
 * @param {Object} options.client - PropProfessor API client.
 * @param {string} options.league - League name.
 * @param {number} options.lookbackHours - Hours to look back for odds history.
 * @param {Function} options.logger - Logger function.
 * @param {boolean} [options.skipHistory=false] - When true, skip odds history
 *   hydration and only fetch screen data. Used by prewarm to warm the screen
 *   cache without incurring per-game history lookups.
 * @returns {Promise<{ league: string, leaguesProcessed: number, gamesProcessed: number, errors: number, screenResult?: Object }>}
 */
async function processLeague({ client, league, lookbackHours, logger, skipHistory = false }) {
  let leaguesProcessed = 0;
  let gamesProcessed = 0;
  let errors = 0;
  let screenResult = null;

  try {
    // Fetch screen data to get upcoming games
    screenResult = await client.queryScreenOddsBestComps({
      market: 'Moneyline',
      league,
      books: [],
      is_live: false
    });

    // Extract gameIds from the result
    const rows = Array.isArray(screenResult?.game_data)
      ? screenResult.game_data
      : Array.isArray(screenResult?.data)
        ? screenResult.data
        : [];

    const gameIds = rows.map((row) => row?.gameId).filter((id) => id && typeof id === 'string');

    // Fetch odds history for each game SEQUENTIALLY within this league.
    // When skipHistory is true, skip this entirely — the prewarm only needs
    // the screen call to warm the screen-data cache, not full line history.
    if (!skipHistory) {
      for (const gameId of gameIds) {
        try {
          const startTimestamp = Math.floor(Date.now() / 1000) - lookbackHours * 3600;
          await client.queryOddsHistory({
            gameId,
            selectionId: '*',
            sportsbooks: [],
            startTimestamp
          });
          gamesProcessed += 1;
        } catch (historyErr) {
          logger(`[prewarm] error fetching history for gameId=${gameId}: ${historyErr.message}`);
          errors += 1;
        }
      }
    }

    logger(`[prewarm] league=${league} games=${gameIds.length}`);
    leaguesProcessed = 1;
  } catch (screenErr) {
    logger(`[prewarm] error fetching screen for league=${league}: ${screenErr.message}`);
    errors += 1;
  }

  return { league, leaguesProcessed, gamesProcessed, errors, screenResult };
}

/**
 * Pre-warm the odds-history cache at session start.
 * After the server signals "initialized", this function fires off background
 * requests to pre-populate the odds-history cache with data for upcoming games.
 *
 * Screen calls for all leagues fire CONCURRENTLY. Odds history calls remain
 * sequential within each league.
 *
 * @param {Object} options - Options object.
 * @param {Object} options.client - PropProfessor API client with queryScreenOddsBestComps and queryOddsHistory methods.
 * @param {Object} options.runtimeConfig - Runtime configuration from getPreWarmConfig().
 * @param {boolean} options.runtimeConfig.enabled - Whether pre-warming is enabled.
 * @param {string[]} options.runtimeConfig.leagues - List of leagues to pre-warm.
 * @param {number} options.runtimeConfig.timeoutMs - Timeout in milliseconds.
 * @param {Function} [options.logger] - Logger function (receives string). Defaults to console.error.
 * @returns {Promise<{ leaguesProcessed: number, gamesProcessed: number, errors: number }>}
 */
async function prewarmOddsHistoryCache({ client, runtimeConfig, logger }) {
  const log = logger || console.error;

  if (!runtimeConfig || !runtimeConfig.enabled) {
    return { leaguesProcessed: 0, gamesProcessed: 0, errors: 0 };
  }

  const { leagues, timeoutMs } = runtimeConfig;
  const lookbackHours = getOddsHistoryLookbackHours();

  let totalLeaguesProcessed = 0;
  let totalGamesProcessed = 0;
  let totalErrors = 0;

  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Pre-warm timeout')), timeoutMs);
  });

  // Run pre-warming with timeout
  const prewarmPromise = (async () => {
    // Fire league screen calls concurrently with a bounded concurrency guard.
    // mapWithConcurrency ensures at most MAX_CONCURRENT_LEAGUES run at once,
    // preventing the server from being hammered when many leagues are configured.
    // Each individual processLeague handles its own errors so one league failure
    // doesn't kill the whole prewarm.
    const results = await mapWithConcurrency(
      leagues,
      (league) => processLeague({ client, league, lookbackHours, logger: log, skipHistory: true }),
      { concurrency: MAX_CONCURRENT_LEAGUES }
    );

    // Aggregate results from all leagues.
    // mapWithConcurrency returns direct values (not Promise.allSettled wrappers)
    // because processLeague catches its own errors and always returns a result.
    for (const result of results) {
      totalLeaguesProcessed += result.leaguesProcessed;
      totalGamesProcessed += result.gamesProcessed;
      totalErrors += result.errors;
    }

    log('[prewarm] done');
    return { leaguesProcessed: totalLeaguesProcessed, gamesProcessed: totalGamesProcessed, errors: totalErrors };
  })();

  try {
    // Race between pre-warming and timeout
    return await Promise.race([prewarmPromise, timeoutPromise]);
  } catch (_err) {
    log(`[prewarm] timeout`);
    return { leaguesProcessed: totalLeaguesProcessed, gamesProcessed: totalGamesProcessed, errors: totalErrors };
  }
}

module.exports = {
  prewarmOddsHistoryCache
};
