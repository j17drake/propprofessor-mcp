'use strict';

/**
 * Convert American odds to implied probability.
 * @param {number|string} odds - American odds value (e.g. -110, +150). Must be a finite non-zero number.
 * @returns {number|null} Implied probability as a decimal between 0 and 1, or null if input is invalid.
 */
function americanOddsToImpliedProbability(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return -n / (-n + 100);
}

/**
 * Parse a time value into milliseconds since Unix epoch.
 * Accepts Date objects, numeric timestamps (seconds or milliseconds), and date strings.
 * @param {Date|number|string} value - The value to parse.
 * @returns {number|null} Milliseconds timestamp, or null if the value cannot be parsed.
 */
function parseHistoryTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Score a row against a query for relevance matching.
 * Combines weighted matches on player name, market, direction/side, and line value.
 * @param {Object} query - Query object with optional search fields.
 * @param {string} [query.player] - Player name to match.
 * @param {string} [query.market] - Market name to match (normalized).
 * @param {string} [query.side] - Direction/side to match (normalized).
 * @param {number|string} [query.line] - Line value to match.
 * @param {Object} row - Row data to score against the query.
 * @param {string} [row.market] - Market name on the row.
 * @param {string} [row.selection] - Selection name on the row.
 * @returns {number} A positive relevance score; higher = more relevant.
 */
function scoreRow(query, row) {
  const text = JSON.stringify(row).toLowerCase();
  const marketText = normalizeMarketName(row.market || row.selection || '');
  let score = 0;
  if (query.player && text.includes(String(query.player).toLowerCase())) score += 4;
  if (query.market && marketText.includes(query.market)) score += 2;
  if (query.side && text.includes(normalizeDirection(query.side))) score += 1;
  if (query.line !== undefined && query.line !== null && text.includes(String(query.line))) score += 1;
  return score;
}

/**
 * Normalize a market name to its canonical short form.
 * Maps common variations (e.g. "pts", "player points") to a consistent string.
 * @param {string} value - Raw market name.
 * @returns {string} Normalized market name, or empty string if input is empty.
 */
function normalizeMarketName(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (['pts', 'point', 'points', 'player points', 'player point'].includes(raw)) return 'points';
  if (['ast', 'assists', 'player assists'].includes(raw)) return 'assists';
  if (['reb', 'rebound', 'rebounds', 'player rebounds'].includes(raw)) return 'rebounds';
  if (['pra', 'points + rebounds + assists', 'points rebounds assists'].includes(raw)) return 'points+rebounds+assists';
  return raw.replace(/\s+/g, ' ');
}

/**
 * Alias map for main-line markets. Each generic alias (e.g. "Total", "Spread") maps
 * to the per-league canonical market name used by the upstream API.
 *
 * Each alias entry is either:
 *   - An object keyed by league (e.g. { NHL: 'Total Goals', MLB: 'Total Runs' })
 *   - A plain string (used as-is regardless of league)
 *
 * Sources verified 2026-06-12 against the live PropProfessor `/screen` endpoint.
 * Note: NBA/WNBA/NCAAB/NCAAF/NFL/SOCCER spread canonical name is "Point Spread",
 * not "Spread" — verified via live screen_raw call. Prior verification
 * (2026-06-09) missed this; tennis still resolves to "Spread" because
 * `normalizeTennisMarketQuery()` expands it to multiple aliases.
 */
const MARKET_ALIASES = {
  // Generic main-line aliases → per-league canonical name
  total: {
    NHL: 'Total Goals',
    MLB: 'Total Runs',
    NBA: 'Total Points',
    WNBA: 'Total Points',
    NCAAB: 'Total Points',
    NCAAF: 'Total Points',
    NFL: 'Total Points',
    TENNIS: 'Total Games',
    UFC: 'Total Rounds',
    SOCCER: 'Total Goals'
  },
  spread: {
    NHL: 'Puck Line',
    MLB: 'Run Line',
    NBA: 'Point Spread',
    WNBA: 'Point Spread',
    NCAAB: 'Point Spread',
    NCAAF: 'Point Spread',
    NFL: 'Point Spread',
    TENNIS: 'Spread',
    SOCCER: 'Point Spread'
  },
  puck_line: { NHL: 'Puck Line' },
  run_line: { MLB: 'Run Line' },
  total_goals: { NHL: 'Total Goals', SOCCER: 'Total Goals' },
  total_runs: { MLB: 'Total Runs' },
  total_points: {
    NBA: 'Total Points',
    WNBA: 'Total Points',
    NCAAB: 'Total Points',
    NCAAF: 'Total Points',
    NFL: 'Total Points'
  },
  total_games: { TENNIS: 'Total Games' },
  total_rounds: { UFC: 'Total Rounds' },
  // Common shorthand for run/puck line
  'run line': { MLB: 'Run Line' },
  rl: { MLB: 'Run Line' },
  pl: { NHL: 'Puck Line' },
  // Handicap aliases (common in tennis, soccer, NBA)
  handicap: {
    NHL: 'Puck Line',
    MLB: 'Run Line',
    NBA: 'Point Spread',
    WNBA: 'Point Spread',
    NCAAB: 'Point Spread',
    NCAAF: 'Point Spread',
    NFL: 'Point Spread',
    TENNIS: 'Spread',
    SOCCER: 'Point Spread'
  },
  game_handicap: { TENNIS: 'Game Handicap' },
  set_handicap: { TENNIS: 'Set Handicap' },
  // Over/Under aliases
  'over/under': {
    NHL: 'Total Goals',
    MLB: 'Total Runs',
    NBA: 'Total Points',
    WNBA: 'Total Points',
    NCAAB: 'Total Points',
    NCAAF: 'Total Points',
    NFL: 'Total Points',
    TENNIS: 'Total Games',
    UFC: 'Total Rounds',
    SOCCER: 'Total Goals'
  },
  ou: {
    NHL: 'Total Goals',
    MLB: 'Total Runs',
    NBA: 'Total Points',
    WNBA: 'Total Points',
    NCAAB: 'Total Points',
    NCAAF: 'Total Points',
    NFL: 'Total Points',
    TENNIS: 'Total Games',
    UFC: 'Total Rounds',
    SOCCER: 'Total Goals'
  },
  total_sets: { TENNIS: 'Total Sets' }
};

/**
 * Normalize a league name the same way `normalizeLeagueName` does, returning an
 * uppercase canonical key suitable for MARKET_ALIASES lookups.
 * @param {string} value - Raw league name.
 * @returns {string} Uppercase canonical league name.
 */
function _aliasLeagueKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

/**
 * Resolve a market name input (which may be a generic alias like "Total" or
 * "Spread") into the canonical per-league market name used by the upstream API.
 *
 * Examples:
 *   resolveMarketName('Total', 'NHL')    => 'Total Goals'
 *   resolveMarketName('Spread', 'MLB')   => 'Run Line'
 *   resolveMarketName('Moneyline', 'NBA') => 'Moneyline'   (no alias, passthrough)
 *   resolveMarketName(undefined, 'NBA')  => 'Moneyline'   (default)
 *
 * The return value is `{ resolved, wasAliased, original, aliasKey }`:
 *   - resolved:    the canonical market name to use in the upstream query
 *   - wasAliased:  true if an alias was applied (i.e. the input was a generic
 *                  name like "Total" that mapped to a league-specific name)
 *   - original:    the original input string (post-trim, pre-normalization)
 *   - aliasKey:    the alias key that was matched (e.g. "total"), or null
 *
 * @param {string|undefined} input - The market name from the caller.
 * @param {string} league - League name (will be uppercased for lookup).
 * @returns {{ resolved: string, wasAliased: boolean, original: string, aliasKey: string|null }}
 */
function resolveMarketName(input, league) {
  const original = String(input == null ? '' : input).trim();
  const leagueKey = _aliasLeagueKey(league);

  // Empty input → default to Moneyline, no alias
  if (!original) {
    return { resolved: 'Moneyline', wasAliased: false, original, aliasKey: null };
  }

  // Normalize: lowercase, collapse spaces to underscores
  const aliasKey = original.toLowerCase().replace(/\s+/g, '_');
  const aliasEntry = Object.prototype.hasOwnProperty.call(MARKET_ALIASES, aliasKey)
    ? MARKET_ALIASES[aliasKey]
    : undefined;

  if (aliasEntry) {
    // Object form: { NHL: 'Total Goals', ... }
    if (typeof aliasEntry === 'object' && aliasEntry !== null) {
      // Try league-specific first
      if (leagueKey && Object.prototype.hasOwnProperty.call(aliasEntry, leagueKey)) {
        return { resolved: aliasEntry[leagueKey], wasAliased: true, original, aliasKey };
      }
      // Fall back to first available entry (deterministic: take the first key)
      const firstKey = Object.keys(aliasEntry)[0];
      if (firstKey) {
        return { resolved: aliasEntry[firstKey], wasAliased: true, original, aliasKey };
      }
    }
    // String form: use as-is
    if (typeof aliasEntry === 'string') {
      return { resolved: aliasEntry, wasAliased: true, original, aliasKey };
    }
  }

  // No alias matched — passthrough unchanged
  return { resolved: original, wasAliased: false, original, aliasKey: null };
}

/**
 * Normalize a direction string to 'over', 'under', or empty.
 * @param {string} value - Raw direction (e.g. 'o', 'over', '+', 'u', 'under', '-').
 * @returns {string} 'over', 'under', or empty string if input is empty.
 */
function normalizeDirection(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (['o', 'over', '+'].includes(raw)) return 'over';
  if (['u', 'under', '-'].includes(raw)) return 'under';
  return raw;
}

/**
 * Normalize a league name to its canonical abbreviation.
 * @param {string} value - Raw league name (e.g. 'nba', 'baseball', 'college basketball').
 * @returns {string} Canonical league abbreviation or uppercase original.
 */
function normalizeLeagueName(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  if (raw === 'NCAAB' || raw === 'COLLEGE BASKETBALL') return 'NCAAB';
  if (raw === 'NCAAF' || raw === 'COLLEGE FOOTBALL') return 'NCAAF';
  if (raw === 'MLB' || raw === 'BASEBALL') return 'MLB';
  if (raw === 'NBA' || raw === 'BASKETBALL') return 'NBA';
  if (raw === 'WNBA' || raw === "WOMEN'S BASKETBALL") return 'WNBA';
  if (raw === 'NFL' || raw === 'FOOTBALL') return 'NFL';
  if (raw === 'NHL' || raw === 'HOCKEY') return 'NHL';
  if (raw === 'SOCCER' || raw === 'FUTBOL' || raw === 'FOOTBALL/SOCCER') return 'SOCCER';
  if (raw === 'TENNIS') return 'TENNIS';
  if (raw === 'UFC' || raw === 'MMA') return 'UFC';
  return raw;
}

/**
 * Check if a book name matches the preferred book (case-insensitive).
 * @param {string} bookName - Book name to check.
 * @param {string} preferredBook - Preferred book name.
 * @returns {boolean} True if the book matches the preferred book.
 */
function matchesPreferredBook(bookName, preferredBook) {
  const normalizedBook = String(bookName || '')
    .trim()
    .toLowerCase();
  const normalizedPreferred = String(preferredBook || '')
    .trim()
    .toLowerCase();
  return Boolean(normalizedBook && normalizedPreferred && normalizedBook === normalizedPreferred);
}

/**
 * Strip null, empty-string, empty-array, and empty-object fields from a row.
 * If `keepFields` is provided, only those fields are retained (with their original
 * values, even if null/empty); all other fields are dropped. Without `keepFields`,
 * the row is returned with all empty-valued fields removed.
 * The input object is not mutated.
 * @param {Object} row - The response row to compact.
 * @param {string[]} [keepFields] - Optional allow-list of field names to keep verbatim.
 * @returns {Object} A new object with the compacted fields.
 */
function compactRow(row, keepFields) {
  if (row === null || typeof row !== 'object') return {};
  const isEmptyValue = (v) =>
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
  if (Array.isArray(keepFields)) {
    const allow = new Set(keepFields);
    const out = {};
    for (const k of allow) {
      if (k in row) out[k] = row[k];
    }
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!isEmptyValue(v)) out[k] = v;
  }
  return out;
}

/**
 * Normalize text by collapsing whitespace, trimming, and lowercasing.
 * @param {string} value - Raw text to normalize.
 * @returns {string} Normalized text, or empty string if input is empty/undefined.
 */
function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const { getOddsHistoryLookbackHours } = require('./mcp-runtime-config');

/**
 * Compute a Unix timestamp (seconds) representing the start of the odds-history lookback window.
 * @param {Object} [options] - Options object.
 * @param {number} [options.lookbackHours] - Number of hours to look back. Falls back to runtime config if omitted.
 * @param {number} [options.nowMs] - Current time in milliseconds. Defaults to Date.now().
 * @returns {number} Unix timestamp in seconds (always >= 0).
 */
function getOddsHistoryStartTimestamp({ lookbackHours = getOddsHistoryLookbackHours(), nowMs = Date.now() } = {}) {
  const safeHours = getOddsHistoryLookbackHours(lookbackHours);
  const now = Number(nowMs);
  const safeNowMs = Number.isFinite(now) ? now : Date.now();
  return Math.max(0, Math.floor(safeNowMs / 1000) - Math.floor(safeHours * 60 * 60));
}

/**
 * Normalize a row by lifting selections.null contents to top level.
 *
 * PropProfessor API returns `selections: { "null": {...} }` and `defaultKey: "null"`
 * for non-prop markets (moneyline, spread, total). The literal string "null" is the
 * API's convention for "no sub-market key", but it leaks through to consumers as a
 * real string.
 *
 * This function:
 * - Lifts contents of `selections.null` to the top level of the row
 * - Removes `defaultKey` when it equals the string "null"
 * - Preserves player props (selections with real player names as keys)
 * - Returns a new object without mutating the input
 *
 * @param {Object} row - Row data from the API.
 * @returns {Object} Normalized row with selections.null lifted and defaultKey removed if "null".
 */
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;

  // Check if we have selections.null (the string "null" as a key)
  const hasNullSelections =
    row.selections &&
    typeof row.selections === 'object' &&
    Object.prototype.hasOwnProperty.call(row.selections, 'null');

  if (!hasNullSelections) {
    // No selections.null to lift - return row as-is (but still check defaultKey)
    if (row.defaultKey === 'null') {
      const out = { ...row };
      delete out.defaultKey;
      return out;
    }
    return { ...row };
  }

  // Lifting selections.null contents to top level
  const { null: nullSelections, ...restOfSelections } = row.selections;
  const liftedRow = {
    ...row,
    ...nullSelections,
    selections: Object.keys(restOfSelections).length > 0 ? restOfSelections : undefined
  };

  // Remove defaultKey if it's the string "null"
  if (liftedRow.defaultKey === 'null') {
    const out = { ...liftedRow };
    delete out.defaultKey;
    return out;
  }

  return liftedRow;
}

module.exports = {
  MARKET_ALIASES,
  americanOddsToImpliedProbability,
  compactRow,
  getOddsHistoryStartTimestamp,
  matchesPreferredBook,
  normalizeDirection,
  normalizeLeagueName,
  normalizeMarketName,
  normalizeRow,
  normalizeText,
  parseHistoryTimeMs,
  resolveMarketName,
  scoreRow
};
