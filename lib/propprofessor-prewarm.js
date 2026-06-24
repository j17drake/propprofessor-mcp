'use strict';

const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

/**
 * Process a single league: fetch screen data, then fetch odds history for each game.
 * The game history calls are sequential within the league.
 *
 * @param {Object} options - Options object.
 * @param {Object} options.client - PropProfessor API client.
 * @param {string} options.league - League name.
 * @param {number} options.lookbackHours - Hours to look back for odds history.
 * @param {Function} options.logger - Logger function.
 * @returns {Promise<{ league: string, leaguesProcessed: number, gamesProcessed: number, errors: number, screenResult?: Object }>}
 */
async function processLeague({ client, league, lookbackHours, logger }) {
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

    // Fetch odds history for each game SEQUENTIALLY within this league
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
    // Fire all league screen calls CONCURRENTLY using Promise.allSettled
    const leaguePromises = leagues.map((league) => processLeague({ client, league, lookbackHours, logger: log }));

    const results = await Promise.allSettled(leaguePromises);

    // Aggregate results from all leagues
    for (const result of results) {
      if (result.status === 'fulfilled') {
        totalLeaguesProcessed += result.value.leaguesProcessed;
        totalGamesProcessed += result.value.gamesProcessed;
        totalErrors += result.value.errors;
      } else {
        // This shouldn't normally happen since processLeague catches errors,
        // but handle it defensively
        totalErrors += 1;
        log(`[prewarm] unexpected error: ${result.reason?.message || 'unknown'}`);
      }
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
