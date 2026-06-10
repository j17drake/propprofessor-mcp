'use strict';

/**
 * Tennis time correction module.
 * Uses ESPN's free public API to get reliable match start times.
 *
 * ESPN API: https://site.api.espn.com/apis/site/v2/sports/tennis/{atp,wta}/scoreboard
 * No API key required. Returns individual match times for every tournament.
 *
 * Strategy:
 * 1. Fetch ATP + WTA scoreboards (2 HTTP calls total)
 * 2. Detect and filter out ESPN placeholder times (e.g. 04:00Z for future rounds)
 * 3. Build a lookup map: normalized full name -> { start, opponent, venue }
 * 4. For each pp-mcp tennis row, find the match by player name
 * 5. Correct if ESPN time differs by >30 min
 *
 * PLACEHOLDER DETECTION:
 * ESPN uses placeholder times (commonly 04:00Z) for matches where the exact time
 * hasn't been set yet (future rounds, TBD matchups). These placeholders are
 * identical across many matches in the same tournament. We detect them by
 * clustering: if 3+ matches share the exact same time AND the match is still
 * "Scheduled" (not In Progress/Final), we treat that time as a placeholder
 * and skip correction for those matches.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

// Cache for ESPN scoreboard data
let _espnCache = null;
let _espnCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Detect if an ESPN time is a placeholder.
 * Placeholder pattern: ESPN uses 04:00Z (4:00 AM UTC) as a default time for
 * matches where the exact schedule hasn't been set yet (future rounds, TBD matchups).
 * These show up as clusters of 10+ Scheduled matches all at the exact same time.
 *
 * Detection: if 10+ Scheduled matches share the exact same time, it's a placeholder.
 * Real match schedules have natural variation (5-30 min gaps between matches).
 *
 * @param {Array} allMatches - All ESPN matches (to detect clustering)
 * @param {string} timeToCheck - ISO time string to test
 * @param {string} status - Match status (e.g. "Scheduled", "Final")
 * @returns {boolean} True if the time is likely a placeholder
 */
function isPlaceholderTime(allMatches, timeToCheck, status) {
  if (!timeToCheck || !status) return false;
  // Only check Scheduled matches — In Progress/Final have real times
  if (status !== 'Scheduled') return false;

  // Count how many Scheduled matches share this exact time
  const sameTimeCount = allMatches.filter(
    m => m.start === timeToCheck && m.status === 'Scheduled'
  ).length;

  // If 10+ Scheduled matches share the exact same time, it's a placeholder.
  // Real tennis schedules have natural variation — you won't see 10+ matches
  // all starting at the exact same minute. ESPN's 04:00Z placeholder produces
  // clusters of 15-45+ matches at the identical time.
  return sameTimeCount >= 10;
}

/**
 * Central Time display string for a given date value.
 * @param {string|number|null|undefined} value - An ISO date string, Unix timestamp, or falsy value
 * @returns {string|null} Formatted Central Time string (e.g. "Jun 7, 2026, 2:00 PM CDT"), or null if input is falsy
 */
function formatCentralTime(value) {
  if (!value) return null;
  const raw = String(value);
  const hasExplicitZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(raw);
  const date = new Date(hasExplicitZone ? raw : `${raw}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).format(date);
}

/**
 * Normalize a player name for comparison.
 * Strips punctuation, lowercases, trims.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well two player names match (0-1).
 * @param {string} a - First player name
 * @param {string} b - Second player name
 * @returns {number} Similarity score: 1.0 = exact, 0.9 = substring, 0.85 = same last name, 0.7 = partial last name, 0 = no match
 */
function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const aParts = na.split(' ');
  const bParts = nb.split(' ');
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  if (aLast === bLast) return 0.85;
  if (aLast.includes(bLast) || bLast.includes(aLast)) return 0.7;

  return 0;
}

/**
 * Fetch tennis scoreboard from ESPN for both ATP and WTA.
 * Results are cached for 5 minutes.
 * Returns a flat array of ESPN match objects:
 *   { player1, player2, start, status, venue }
 * @returns {Promise<Array<{player1: string, player2: string, start: string, status: string, venue: string}>>} Flat array of ESPN match objects
 */
async function fetchEspnMatches() {
  const now = Date.now();
  if (_espnCache && now - _espnCacheTime < CACHE_TTL_MS) {
    return _espnCache;
  }

  const circuits = ['atp', 'wta'];
  const allMatches = [];

  for (const circuit of circuits) {
    try {
      const url = `${ESPN_BASE}/${circuit}/scoreboard`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'propprofessor-mcp/1.0.7 (tennis-time-correction)',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) continue;

      const data = await response.json();
      const events = Array.isArray(data?.events) ? data.events : [];

      for (const event of events) {
        const groupings = Array.isArray(event?.groupings) ? event.groupings : [];
        for (const group of groupings) {
          const competitions = Array.isArray(group?.competitions) ? group.competitions : [];
          for (const comp of competitions) {
            const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
            if (competitors.length < 2) continue;

            const player1 = competitors[0]?.athlete?.displayName || '';
            const player2 = competitors[1]?.athlete?.displayName || '';
            if (!player1 || !player2) continue;

            const matchDate = comp.date || '';
            const status = comp?.status?.type?.description || '';
            const venue = comp?.venue?.fullName || '';

            allMatches.push({
              player1: player1.trim(),
              player2: player2.trim(),
              start: matchDate,
              status,
              venue
            });
          }
        }
      }
    } catch {
      // Circuit failed, continue with whatever we have
      continue;
    }
  }

  _espnCache = allMatches;
  _espnCacheTime = Date.now();
  return allMatches;
}

/**
 * Find the best ESPN match for a given pp-mcp row.
 * Matches by player name similarity to either side of the ESPN match.
 */
function findEspnMatch(espnMatches, ppHomeTeam, ppAwayTeam) {
  if (!espnMatches || !espnMatches.length) return null;

  let best = null;
  let bestScore = 0;

  for (const m of espnMatches) {
    // Check if either player matches home or away
    const homeToP1 = nameSimilarity(ppHomeTeam, m.player1);
    const homeToP2 = nameSimilarity(ppHomeTeam, m.player2);
    const awayToP1 = nameSimilarity(ppAwayTeam, m.player1);
    const awayToP2 = nameSimilarity(ppAwayTeam, m.player2);

    // Score: we need both players to match (one on each side)
    const matchScore1 = Math.min(Math.max(homeToP1, awayToP1), Math.max(homeToP2, awayToP2));
    const matchScore2 = Math.min(Math.max(homeToP2, awayToP2), Math.max(homeToP1, awayToP1));
    // Higher of the two crossing patterns
    const combined = Math.max(matchScore1, matchScore2);

    if (combined > bestScore) {
      bestScore = combined;
      best = {
        time: m.start,
        match: `${m.player1} vs ${m.player2}`,
        confidence: combined,
        status: m.status,
        venue: m.venue
      };
    }
  }

  return bestScore >= 0.5 ? best : null;
}

/**
 * Correct tennis match times for an array of ranked rows using ESPN data.
 * Mutates and returns the same array with corrected `start` fields.
 * @param {Array<Object>} rows - Array of tennis match rows; each row expected to have homeTeam, awayTeam, start/startTimestamp fields
 * @returns {Promise<Array<Object>>} The same rows array with corrected start fields and added metadata (startDisplay, startCorrected, startSource, startMatchName, etc.)
 */
async function correctTennisTimes(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  // Fetch all ESPN matches (ATP + WTA, cached for 5 min)
  let espnMatches;
  try {
    espnMatches = await fetchEspnMatches();
  } catch {
    espnMatches = [];
  }

  if (!espnMatches.length) {
    // ESPN unavailable — fall back to just CT formatting
    for (const row of rows) {
      const timeForDisplay = row.start || row.startTimestamp;
      if (timeForDisplay) {
        row.startDisplay = formatCentralTime(timeForDisplay);
      }
    }
    return rows;
  }

  let corrected = 0;

  for (const row of rows) {
    const homeTeam = String(row.homeTeam || '').trim();
    const awayTeam = String(row.awayTeam || '').trim();
    const startTime = row.start || row.startTimestamp || '';

    const match = findEspnMatch(espnMatches, homeTeam, awayTeam);

    // Apply correction if found and meaningful
    if (match && match.time) {
      // Skip if ESPN time is a placeholder (cluster of identical times for future rounds)
      if (isPlaceholderTime(espnMatches, match.time, match.status)) {
        // ESPN time is a placeholder — keep pp-mcp's original time
        row.startSource = 'pp-mcp (espn-placeholder-skipped)';
      } else {
        const oldTime = startTime ? new Date(startTime) : new Date(0);
        const newTime = new Date(match.time);
        const diffMs = Math.abs(newTime.getTime() - oldTime.getTime());

        if (diffMs > 30 * 60 * 1000 || !startTime) {
          row.start = match.time;
          row.startCorrected = true;
          row.startSource = 'espn';
          row.startMatchName = match.match;
          row.startConfidence = Math.round(match.confidence * 100) / 100;
          if (match.venue) row.startVenue = match.venue;
          if (match.status) row.startStatus = match.status;
          corrected++;
        }
      }
    }

    // Always set a CT display string
    const timeForDisplay = row.start || row.startTimestamp;
    if (timeForDisplay) {
      row.startDisplay = formatCentralTime(timeForDisplay);
    }
  }

  if (corrected > 0 && typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(`[tennis-times] Corrected ${corrected}/${rows.length} tennis match times via ESPN\n`);
  }

  return rows;
}

module.exports = {
  correctTennisTimes,
  fetchEspnMatches,
  nameSimilarity,
  formatCentralTime,
  isPlaceholderTime
};
