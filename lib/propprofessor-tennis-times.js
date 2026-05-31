'use strict';

/**
 * Tennis time correction module.
 * Queries SportScore's free public API to get reliable match times for tennis.
 *
 * Strategy:
 * 1. Map pp-mcp's last-name-only tennis data to full names via a lookup table
 * 2. Use full names to query SportScore's team endpoint for each player's schedule
 * 3. Match by opponent to find the correct start time
 *
 * SportScore: free public API, no API key, ~10k req/day/IP, CORS-open.
 */

const { resolvePlayerName, getNameSlug } = require('./propprofessor-tennis-names');
const SPORTSCORE_BASE = 'https://sportscore.com';

/**
 * Central Time display string for a given date value.
 * Always returns America/Chicago format: "May 31, 2026, 10:35 AM CT"
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

// Caches
const _teamCache = new Map();
const _fetchQueue = new Set();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Normalize a name for comparison.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a player's match schedule from SportScore team endpoint.
 */
async function fetchPlayerSchedule(slug) {
  if (!slug) return null;

  const now = Date.now();
  const cached = _teamCache.get(slug);
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return cached.matches;
  }

  if (_fetchQueue.has(slug)) {
    await new Promise(r => setTimeout(r, 200));
    const retry = _teamCache.get(slug);
    return retry ? retry.matches : null;
  }

  _fetchQueue.add(slug);
  try {
    const url = `${SPORTSCORE_BASE}/api/widget/team/?sport=tennis&slug=${encodeURIComponent(slug)}&limit=15`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'propprofessor-mcp/1.0.7 (tennis-time-correction)',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      if (response.status === 404) {
        _teamCache.set(slug, { ts: Date.now(), matches: null });
        return null;
      }
      throw new Error(`SportScore returned ${response.status}`);
    }

    const data = await response.json();
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    _teamCache.set(slug, { ts: Date.now(), matches });
    return matches;
  } catch (err) {
    const stale = _teamCache.get(slug);
    if (stale) return stale.matches;
    return null;
  } finally {
    _fetchQueue.delete(slug);
  }
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
 * Find the best match in a player's schedule for a given opponent + date.
 */
function findOpponentMatch(schedule, ppHomeTeam, ppAwayTeam, lookupFullName, matchTime) {
  if (!schedule || !schedule.length) return null;

  const matchDateStr = matchTime ? new Date(matchTime).toISOString().slice(0, 10) : null;
  const lookupNormalized = normalizeName(lookupFullName);

  let best = null;
  let bestScore = 0;

  for (const m of schedule) {
    const home = String(m.home || '').trim();
    const away = String(m.away || '').trim();
    if (!home || !away) continue;

    // Determine which side is our player
    let ourScore = nameSimilarity(lookupNormalized, home);
    let opponentName = away;
    if (ourScore < 0.4) {
      ourScore = nameSimilarity(lookupNormalized, away);
      opponentName = home;
    }
    if (ourScore < 0.4) continue;

    // Check opponent against either pp-mcp team name
    const oppScore = Math.max(
      nameSimilarity(ppHomeTeam, opponentName),
      nameSimilarity(ppAwayTeam, opponentName)
    );
    if (oppScore < 0.3) continue;

    const combined = (ourScore + oppScore) / 2;

    // Date bonus (prefer the same day)
    let dateBonus = 0;
    if (matchDateStr && m.time) {
      const mDate = new Date(m.time).toISOString().slice(0, 10);
      if (mDate === matchDateStr) dateBonus = 0.2;
    }

    const total = combined + dateBonus;
    if (total > bestScore) {
      bestScore = total;
      best = {
        time: m.time,
        match: `${home} vs ${away}`,
        confidence: combined
      };
    }
  }

  return bestScore >= 0.5 ? best : null;
}

/**
 * Correct tennis match times for an array of ranked rows.
 * Mutates and returns the same array with corrected `start` fields.
 */
async function correctTennisTimes(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  let corrected = 0;

  for (const row of rows) {
    const homeTeam = String(row.homeTeam || '').trim();
    const awayTeam = String(row.awayTeam || '').trim();
    const startTime = row.start || row.startTimestamp || '';

    // Get full names for both players
    const homeFull = resolvePlayerName(homeTeam);
    const awayFull = resolvePlayerName(awayTeam);
    const homeSlug = homeFull ? getNameSlug(homeTeam) : null;
    const awaySlug = awayFull ? getNameSlug(awayTeam) : null;

    // Try looking up each player's schedule
    let bestMatch = null;
    let bestScore = 0;

    const lookups = [
      { name: homeFull || homeTeam, slug: homeSlug, isHome: true },
      { name: awayFull || awayTeam, slug: awaySlug, isHome: false },
    ];

    for (const lookup of lookups) {
      if (!lookup.slug) continue;

      const schedule = await fetchPlayerSchedule(lookup.slug);
      if (!schedule || !schedule.length) continue;

      const match = findOpponentMatch(
        schedule, homeTeam, awayTeam,
        lookup.name, startTime
      );

      if (match && match.confidence > bestScore) {
        bestScore = match.confidence;
        bestMatch = match;
      }
    }

    // Apply correction if found and meaningful
    if (bestMatch && bestMatch.time) {
      const oldTime = startTime ? new Date(startTime) : new Date(0);
      const newTime = new Date(bestMatch.time);
      const diffMs = Math.abs(newTime.getTime() - oldTime.getTime());

      if (diffMs > 30 * 60 * 1000 || !startTime) {
        row.start = bestMatch.time;
        row.startCorrected = true;
        row.startSource = 'sportscore';
        row.startMatchName = bestMatch.match;
        row.startConfidence = Math.round(bestMatch.confidence * 100) / 100;
        corrected++;
      }
    }

    // Always set a CT display string for every tennis row
    const timeForDisplay = row.start || row.startTimestamp;
    if (timeForDisplay) {
      row.startDisplay = formatCentralTime(timeForDisplay);
    }
  }

  if (corrected > 0 && typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(`[tennis-times] Corrected ${corrected}/${rows.length} tennis match times via SportScore\n`);
  }

  return rows;
}

module.exports = {
  correctTennisTimes,
  fetchPlayerSchedule,
  nameSimilarity,
  formatCentralTime
};
