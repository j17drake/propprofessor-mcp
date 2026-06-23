'use strict';

const { getMlbGameContext } = require('./propprofessor-mlb-game-context');
const { getBasketballGameContext } = require('./propprofessor-basketball-game-context');
const { getNhlContext } = require('./propprofessor-nhl-context');
const { getTennisContext } = require('./propprofessor-tennis-context');
const { getUfcContext } = require('./propprofessor-ufc-context');
const { LruCache } = require('./propprofessor-lru-cache');

const GAME_CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000;
const _gameContextCache = new LruCache(128);

/**
 * Parse a game string like "New York Mets vs Philadelphia Phillies"
 * into { team1, team2 }.
 */
function parseGameString(game) {
  if (!game || typeof game !== 'string') return { team1: '', team2: '' };
  const parts = game.split(/\s+(?:vs|@|at)\s+/i);
  if (parts.length >= 2) {
    return { team1: (parts[0] || '').trim(), team2: (parts[1] || '').trim() };
  }
  return { team1: game.trim(), team2: '' };
}

/**
 * Guess the game date from start field or default to today.
 */
function parseGameDate(start) {
  if (!start) return new Date().toISOString().split('T')[0];
  try {
    const d = new Date(start);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /* fall through */ }
  return new Date().toISOString().split('T')[0];
}

/**
 * Map league strings to canonical sport names for context lookup.
 */
function canonicalSport(sport) {
  if (!sport || typeof sport !== 'string') return null;
  const map = { NBA: 'NBA', WNBA: 'WNBA', MLB: 'MLB', Tennis: 'Tennis', NHL: 'NHL', NFL: 'NFL', UFC: 'UFC', Soccer: 'Soccer' };
  return map[sport] || null;
}

/**
 * Get sport-specific game context for a selection.
 *
 * @param {Object} options
 * @param {string} options.sport - League/sport name
 * @param {string} [options.selection] - The selection/player string
 * @param {string} [options.game] - Full game description (e.g. "Lakers vs Celtics")
 * @param {string} [options.start] - Game start time ISO string
 * @param {string} [options.market] - Market type
 * @returns {Promise<Object>}
 */
async function getGameContext({ sport, selection, game, start, market } = {}) {
  const csport = canonicalSport(sport);
  // Cache key includes `start` so a rescheduled match doesn't return a
  // stale result. Without this, RC3: a match tagged with start=T-60min
  // gets cached; if the match is rescheduled to start 24h later, calls
  // for 30 more minutes return the original cached `unknown` result.
  const cacheKey = `gc:${csport || '?'}:${selection || ''}:${game || ''}:${start || ''}`;
  const cached = _gameContextCache.get(cacheKey);
  if (cached) {
    // Freshness rule: if the game is imminent (tipping within 2h), don't
    // trust a cache entry older than 5min. A reschedule right before tip
    // would otherwise serve stale context up to 30min after the change.
    // For non-imminent games, the 30min TTL is fine — surface/level don't
    // change at distance from tip.
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    const startMs = start ? new Date(start).getTime() : Infinity;
    const isImminent = Number.isFinite(startMs) && (startMs - Date.now()) < 2 * 60 * 60 * 1000;
    if (!isImminent || ageMs < 5 * 60 * 1000) {
      return { ...cached, cached: true };
    }
  }

  const { team1, team2 } = parseGameString(game);
  const gameDate = parseGameDate(start);

  let result;

  switch (csport) {
    case 'MLB': {
      try {
        const { findMlbGamePk } = require('./propprofessor-mlb-game-context');
        const gamePk = game ? await findMlbGamePk({ isoDate: gameDate, awayTeam: team1, homeTeam: team2 }) : null;
        if (gamePk) {
          result = await getMlbGameContext({ gamePk });
        } else {
          result = {
            ok: true, sport: 'MLB', riskFlag: 'unknown',
            riskSummary: 'gamePk not resolved for MLB context', signals: {},
          };
        }
      } catch {
        result = { ok: true, sport: 'MLB', riskFlag: 'unknown', riskSummary: 'MLB context unavailable', signals: {} };
      }
      break;
    }

    case 'NBA':
    case 'WNBA': {
      result = await getBasketballGameContext({
        gamePk: game,
        sport: csport,
        awayTeam: team1,
        homeTeam: team2,
        gameDate,
      });
      break;
    }

    case 'Tennis': {
      result = await getTennisContext({
        player1: team1 || selection,
        player2: team2,
        tournament: game,
        start: start
      });
      break;
    }

    case 'NHL': {
      result = await getNhlContext({
        gamePk: game,
        awayTeam: team1,
        homeTeam: team2,
        gameDate,
      });
      break;
    }

    case 'UFC': {
      result = await getUfcContext({
        event: game || selection,
        weightClass: null, // typically not available from screen data
      });
      break;
    }

    default: {
      result = {
        ok: true,
        sport: csport || null,
        gamePk: game || null,
        riskFlag: 'clean',
        riskSummary: selection
          ? `${csport || 'Unknown'} — no game-level context available`
          : null,
        signals: {},
        fetchedAt: new Date().toISOString(),
      };
      break;
    }
  }

  // Fill in gamePk if not set
  if (!result.gamePk) result.gamePk = game || null;
  if (!result.cached) result.cached = false;

  // Cache non-error results
  if (result.riskFlag !== 'error') {
    _gameContextCache.set(cacheKey, result, GAME_CONTEXT_CACHE_TTL_MS);
  }

  return result;
}

module.exports = { getGameContext, parseGameString };
