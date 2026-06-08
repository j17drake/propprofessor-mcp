'use strict';

/**
 * Verbosity formatters for bet data.
 *
 * Converts raw bet objects into different output formats:
 * - minimal: Plain English for casual bettors
 * - standard: Structured data with verbose fields stripped (for intermediate bettors)
 * - full: Raw output (no transformation)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierToConfidence(tier) {
  const t = String(tier || '').toUpperCase();
  if (t === 'TIER 1') return 'high confidence';
  if (t === 'TIER 2') return 'moderate confidence';
  return 'low confidence';
}

function riskScoreToLabel(riskScore) {
  const score = Number.isFinite(Number(riskScore)) ? Number(riskScore) : 0;
  if (score >= 7) return 'high risk';
  if (score >= 4) return 'moderate risk';
  return 'low risk';
}

function actionWord(tier) {
  const t = String(tier || '').toUpperCase();
  if (t === 'TIER 1' || t === 'TIER 2') return 'Bet';
  return 'Consider';
}

function formatOdds(odds) {
  if (odds === null || odds === undefined || odds === '') return '';
  const n = Number(odds);
  if (!Number.isFinite(n)) return String(odds);
  // American odds: positive gets '+', negative keeps '-'
  return n > 0 ? `+${Math.round(n)}` : String(Math.round(n));
}

function safeString(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

// ---------------------------------------------------------------------------
// Minimal formatter (casual bettors)
// ---------------------------------------------------------------------------

/**
 * Format a single bet as a plain-English sentence.
 *
 * Example output:
 *   "Bet Bonfim at +105 (Bonfim vs Muhammad, UFC Moneyline). High confidence, low risk. Why: Sharp books agree, low injury risk."
 *
 * High-risk bets (riskScore >= 7) get a warning emoji (⚠️).
 */
function formatBetMinimal(bet = {}) {
  const selection = safeString(bet.selection || bet.participant || bet.pick, 'Unknown selection');
  const odds = formatOdds(bet.odds ?? bet.targetBookOdds);
  const game = safeString(bet.game, '');
  const league = safeString(bet.league, '');
  const market = safeString(bet.market, '');
  const tier = safeString(bet.confidenceTier || bet.tier, '');
  const riskScore = bet.riskScore;
  const rationale = safeString(bet.rationale, '');

  const confidence = tierToConfidence(tier);
  const riskLabel = riskScoreToLabel(riskScore);
  const action = actionWord(tier);

  const oddsStr = odds ? ` at ${odds}` : '';
  const gameStr = game ? ` (${game}${league || market ? `, ${[league, market].filter(Boolean).join(' ')}` : ''})` : '';
  const warning = Number.isFinite(Number(riskScore)) && Number(riskScore) >= 7 ? ' ⚠️' : '';

  let sentence = `${action} ${selection}${oddsStr}${gameStr}. ${capitalize(confidence)}, ${riskLabel}.${warning}`;
  if (rationale) {
    sentence += ` Why: ${rationale}`;
  }
  return sentence.trim();
}

/**
 * Format an array of bets as a numbered list.
 * Returns "No strong plays right now." if the array is empty.
 */
function formatBetsMinimal(bets = []) {
  if (!Array.isArray(bets) || bets.length === 0) {
    return 'No strong plays right now.';
  }
  return bets
    .map((bet, i) => `${i + 1}. ${formatBetMinimal(bet)}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Standard formatter (intermediate bettors)
// ---------------------------------------------------------------------------

/**
 * Fields to keep in the standard output. Everything else (lineHistory,
 * scoreBreakdown, debug, oddsMap, etc.) is stripped.
 */
const STANDARD_KEEP_FIELDS = new Set([
  'selection',
  'participant',
  'pick',
  'odds',
  'targetBookOdds',
  'game',
  'gameId',
  'league',
  'market',
  'start',
  'tier',
  'confidenceTier',
  'edge',
  'consensusEdge',
  'riskScore',
  'movementGrade',
  'kaiCall',
  'rationale',
  'consensusScore',
  'consensusBookCount',
  'screenScore',
  'executionQuality',
  'clv',
  'clvProxyPct'
]);

/**
 * Fields that are explicitly verbose and must be stripped even if not in
 * the keep-list (belt-and-suspenders).
 */
const STANDARD_STRIP_FIELDS = new Set([
  'lineHistory',
  'scoreBreakdown',
  'debug',
  'oddsMap',
  'filteredLineHistory',
  'movementDebug',
  'passReasons',
  'nearMissDetails'
]);

/**
 * Format a single bet for standard output: keep key fields, strip verbose
 * debug payloads.
 */
function formatBetStandard(bet = {}) {
  if (!bet || typeof bet !== 'object') return {};
  const out = {};
  for (const key of Object.keys(bet)) {
    if (STANDARD_STRIP_FIELDS.has(key)) continue;
    if (STANDARD_KEEP_FIELDS.has(key)) {
      out[key] = bet[key];
    }
  }
  // Ensure the key fields the spec calls out are always present (with safe defaults)
  if (out.selection === undefined && bet.participant !== undefined) out.selection = bet.participant;
  if (out.selection === undefined && bet.pick !== undefined) out.selection = bet.pick;
  if (out.odds === undefined && bet.targetBookOdds !== undefined) out.odds = bet.targetBookOdds;
  if (out.tier === undefined && bet.confidenceTier !== undefined) out.tier = bet.confidenceTier;
  if (out.edge === undefined && bet.consensusEdge !== undefined) out.edge = bet.consensusEdge;
  return out;
}

/**
 * Format an array of bets for standard output.
 */
function formatBetsStandard(bets = []) {
  if (!Array.isArray(bets)) return [];
  return bets.map(formatBetStandard);
}

// ---------------------------------------------------------------------------
// Response-level formatters
// ---------------------------------------------------------------------------

/**
 * Format a recommended_bets response for minimal output.
 * Input shape: { ok, totalRecommended, leagues: [{ league, count, plays: [...] }] }
 */
function formatRecommendedBetsMinimal(response = {}) {
  const leagues = Array.isArray(response.leagues) ? response.leagues : [];
  const allPlays = leagues.flatMap((l) => Array.isArray(l.plays) ? l.plays.map((p) => ({ ...p, league: l.league })) : []);
  const summary = formatBetsMinimal(allPlays);
  return {
    summary,
    count: allPlays.length
  };
}

/**
 * Format a recommended_bets response for standard output.
 * Keeps league grouping but strips verbose fields from each play.
 */
function formatRecommendedBetsStandard(response = {}) {
  const leagues = Array.isArray(response.leagues) ? response.leagues : [];
  return {
    ...response,
    leagues: leagues.map((l) => ({
      ...l,
      plays: Array.isArray(l.plays) ? formatBetsStandard(l.plays) : []
    }))
  };
}

/**
 * Format a sharp_plays response for minimal output.
 * Input shape: { ok, count, result: [...] }
 */
function formatSharpPlaysMinimal(response = {}) {
  const result = Array.isArray(response.result) ? response.result : [];
  const summary = formatBetsMinimal(result);
  return {
    summary,
    count: result.length
  };
}

/**
 * Format a sharp_plays response for standard output.
 */
function formatSharpPlaysStandard(response = {}) {
  return {
    ...response,
    result: Array.isArray(response.result) ? formatBetsStandard(response.result) : []
  };
}

/**
 * Format a screen_ranked response for minimal output.
 * Input shape: { ok, result: [...] }
 */
function formatScreenRankedMinimal(response = {}) {
  const result = Array.isArray(response.result) ? response.result : [];
  const summary = formatBetsMinimal(result);
  return {
    summary,
    count: result.length
  };
}

/**
 * Format a screen_ranked response for standard output.
 */
function formatScreenRankedStandard(response = {}) {
  return {
    ...response,
    result: Array.isArray(response.result) ? formatBetsStandard(response.result) : []
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function capitalize(str) {
  const s = String(str || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = {
  // Single-bet formatters
  formatBetMinimal,
  formatBetStandard,
  // Array formatters
  formatBetsMinimal,
  formatBetsStandard,
  // Response-level formatters
  formatRecommendedBetsMinimal,
  formatRecommendedBetsStandard,
  formatSharpPlaysMinimal,
  formatSharpPlaysStandard,
  formatScreenRankedMinimal,
  formatScreenRankedStandard,
  // Helpers (exported for testing)
  tierToConfidence,
  riskScoreToLabel,
  actionWord,
  formatOdds,
  STANDARD_KEEP_FIELDS,
  STANDARD_STRIP_FIELDS
};
