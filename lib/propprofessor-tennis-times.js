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
 * 2. Build a lookup map: normalized full name -> { start, opponent, venue }
 * 3. For each pp-mcp tennis row, find the match by player name
 * 4. Correct if ESPN time differs by >30 min
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

// Cache for ESPN scoreboard data
let _espnCache = null;
let _espnCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Central Time display string for a given date value.
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
 * Returns a flat array of ESPN match objects:
 *   { name, opponent, start, status, venue }
 */
async function fetchEspnMatches() {
  const now = Date.now();
  if (_espnCache && (now - _espnCacheTime) < CACHE_TTL_MS) {
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
          'Accept': 'application/json'
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
    } catch (err) {
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
    const matchScore1 = Math.min(
      Math.max(homeToP1, awayToP1),
      Math.max(homeToP2, awayToP2)
    );
    const matchScore2 = Math.min(
      Math.max(homeToP2, awayToP2),
      Math.max(homeToP1, awayToP1)
    );
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
  formatCentralTime
};
