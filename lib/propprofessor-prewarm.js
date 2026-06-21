'use strict';

const { getOddsHistoryCache, getOddsHistoryCacheTtlMs, getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

/**
 * Pre-warm the odds-history cache at session start.
 * After the server signals "initialized", this function fires off background
 * requests to pre-populate the odds-history cache with data for upcoming games.
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

  let leaguesProcessed = 0;
  let gamesProcessed = 0;
  let errors = 0;

  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Pre-warm timeout')), timeoutMs);
  });

  // Run pre-warming with timeout
  const prewarmPromise = (async () => {
    for (const league of leagues) {
      try {
        // Fetch screen data to get upcoming games
        const screenResult = await client.queryScreenOddsBestComps({
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

        const gameIds = rows
          .map((row) => row?.gameId)
          .filter((id) => id && typeof id === 'string');

        // Fetch odds history for each game
        for (const gameId of gameIds) {
          try {
            // Use '*' as selectionId to get all selections for the game
            // startTimestamp: 6 hours ago (matching default lookback)
            const startTimestamp = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

            await client.queryOddsHistory({
              gameId,
              selectionId: '*',
              sportsbooks: [],
              startTimestamp
            });

            gamesProcessed += 1;
          } catch (historyErr) {
            log(`[prewarm] error fetching history for gameId=${gameId}: ${historyErr.message}`);
            errors += 1;
          }
        }

        log(`[prewarm] league=${league} games=${gameIds.length}`);
        leaguesProcessed += 1;
      } catch (screenErr) {
        log(`[prewarm] error fetching screen for league=${league}: ${screenErr.message}`);
        errors += 1;
      }
    }

    log('[prewarm] done');
    return { leaguesProcessed, gamesProcessed, errors };
  })();

  try {
    // Race between pre-warming and timeout
    return await Promise.race([prewarmPromise, timeoutPromise]);
  } catch (_err) {
    log(`[prewarm] timeout`);
    return { leaguesProcessed, gamesProcessed, errors };
  }
}

module.exports = {
  prewarmOddsHistoryCache
};