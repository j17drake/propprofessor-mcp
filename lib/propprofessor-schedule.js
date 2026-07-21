"use strict";

/**
 * PropProfessor Schedule Service
 * Replaces all workarounds for stale tennis game dates with authoritative schedule source.
 * Primary source: Sofascore (covers ATP/WTA/Challenger/ITF)
 * Fallback: ESPN tennis schedule for ATP/WTA only
 */

const https = require('https');
const http = require('http');

/**
 * Fetch tennis schedule from Sofascore API
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of tournament events
 */
async function fetchSofascoreSchedule(date) {
  return new Promise((resolve, reject) => {
    const url = `https://api.sofascore.com/api/v1/sport/tennis/scheduled-tournaments/${date}/page/1`;
    const client = process.env.NODE_ENV === 'production' ? https : http;

    const request = client.get(url, {
      headers: {
        'User-Agent': 'PropProfessor-Node/1.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    let data = '';
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Sofascore API failed with status ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.events || []);
        } catch (err) {
          reject(new Error(`Failed to parse Sofascore response: ${err.message}`));
        }
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Sofascore API request timed out'));
    });
  });
}

/**
 * Fetch ESPN tennis schedule for ATP/WTA tournaments
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of ESPN match data
 */
async function fetchESPNTennisSchedule(date) {
  // ESPN tennis schedule extraction logic
  // This is a simplified version - actual implementation would need to
  // parse ESPN's tennis schedule page and extract match times and participants
  const matches = [];

  // Mock implementation - replace with actual ESPN scraping logic
  console.warn('[schedule] ESPN tennis schedule fallback not fully implemented');

  return matches;
}

/**
 * Convert Sofascore event data to PropProfessor game format
 * @param {Object} event - Sofascore event object
 * @param {string} tournament - Tournament name
 * @returns {Object} Game object with gameId
 */
function mapSofascoreEventToGame(event, tournament) {
  const eventId = event.id?.toString();
  const startTimestamp = event.startTime || event.time;

  if (!eventId || !startTimestamp) {
    return null;
  }

  // Extract teams from participants
  const participants = event.participants || [];
  const player1 = participants[0]?.name || '';
  const player2 = participants[1]?.name || '';

  if (!player1 || !player2) {
    return null;
  }

  // Generate gameId using PP's convention: Tennis:PREMATCH:player1:player2:unixTimestamp
  const unixTimestamp = Math.floor(startTimestamp / 1000);
  const gameId = `Tennis:PREMATCH:${player1}:${player2}:${unixTimestamp}`;

  return {
    gameId,
    tournament,
    startTimestamp,
    homeTeam: player1,
    awayTeam: player2,
    eventId,
    // Store original Sofascore data for reference
    sofascoreData: {
      event,
      tournament
    }
  };
}

/**
 * Get today's tennis schedule with Sofascore as primary source
 * @returns {Promise<Array>} Array of ScheduleGame objects
 */
async function getTodayTennisSchedule() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let scheduleGames = [];

  try {
    // Try Sofascore first (primary source)
    const sofascoreEvents = await fetchSofascoreSchedule(today);
    console.log(`[schedule] Found ${sofascoreEvents.length} events from Sofascore`);

    for (const event of sofascoreEvents) {
      const tournament = event.tournament?.name || 'Unknown Tournament';
      const mappedGame = mapSofascoreEventToGame(event, tournament);

      if (mappedGame) {
        scheduleGames.push(mappedGame);
      }
    }
  } catch (err) {
    console.warn('[schedule] Sofascore failed, using ESPN fallback:', err.message);

    // Fallback to ESPN for ATP/WTA tournaments
    try {
      const espnMatches = await fetchESPNTennisSchedule(today);
      console.log(`[schedule] Found ${espnMatches.length} matches from ESPN`);

      for (const match of espnMatches) {
        const mappedGame = mapSofascoreEventToGame(
          {
            id: match.eventId,
            startTime: match.startTime,
            participants: match.participants
          },
          match.tournament || 'ESPN Tournament'
        );

        if (mappedGame) {
          scheduleGames.push(mappedGame);
        }
      }
    } catch (espnErr) {
      console.error('[schedule] ESPN fallback also failed:', espnErr.message);
      // Both sources failed - continue with empty schedule
    }
  }

  console.log(`[schedule] Total scheduled games for ${today}: ${scheduleGames.length}`);
  return scheduleGames;
}

/**
 * Get gameId from schedule based on teams and date
 * @param {Array} scheduleGames - Array of ScheduleGame objects
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {string|null} GameId or null if not found
 */
function getGameIdFromSchedule(scheduleGames, homeTeam, awayTeam, date) {
  // Normalize team names for matching
  const normalize = (name) => name?.toLowerCase().trim();
  const homeNorm = normalize(homeTeam);
  const awayNorm = normalize(awayTeam);

  for (const game of scheduleGames) {
    const gameDate = new Date(game.startTimestamp).toISOString().split('T')[0];

    if (gameDate !== date) continue;

    const homeGameNorm = normalize(game.homeTeam);
    const awayGameNorm = normalize(game.awayTeam);

    // Match both teams (order doesn't matter for tennis)
    if ((homeNorm === homeGameNorm && awayNorm === awayGameNorm) ||
        (homeNorm === awayGameNorm && awayNorm === homeGameNorm)) {
      return game.gameId;
    }
  }

  return null;
}

/**
 * Resolve gameIds for stale games using schedule
 * @param {Array} rows - Screen rows to check for stale games
 * @param {string} date - Date to check against
 * @returns {Array} Array of gameIds that need rescue
 */
async function resolveStaleGameIds(rows, date) {
  try {
    const scheduleGames = await getTodayTennisSchedule();
    const staleGameIds = [];

    for (const row of rows) {
      const rowStart = row.start;
      if (!rowStart) continue;

      // Parse start time to check if it's stale (before today)
      const startTime = new Date(rowStart);
      const gameDate = startTime.toISOString().split('T')[0];

      if (gameDate !== date) continue;

      const rowHome = row.homeTeam || '';
      const rowAway = row.awayTeam || '';

      // Get gameId from schedule using team names and date
      const gameId = getGameIdFromSchedule(scheduleGames, rowHome, rowAway, date);

      if (gameId) {
        staleGameIds.push(gameId);
      }
    }

    return [...new Set(staleGameIds)];
  } catch (err) {
    console.error('[schedule] Failed to resolve stale game IDs:', err.message);
    return [];
  }
}

module.exports = {
  fetchSofascoreSchedule,
  fetchESPNTennisSchedule,
  mapSofascoreEventToGame,
  getTodayTennisSchedule,
  getGameIdFromSchedule,
  resolveStaleGameIds
};
