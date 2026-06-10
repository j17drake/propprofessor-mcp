'use strict';

/**
 * Phase 2: Movement Quality Grade & Qualitative Risk Score
 *
 * Synthesizes all existing signals (movementQuality, movementLabel, edge,
 * consensus, steam, executionQuality, CLV) into:
 * 1. movementGrade — green / yellow / red (at-a-glance quality)
 * 2. riskScore — 1–10 (lower = better, 1 = cleanest)
 * 3. kaiCall — BET / CONSIDER / PASS (actionable recommendation)
 *
 * Phase 3+: Tier Stability (Hysteresis)
 * Raw tiers are noisy — small odds movements can flip a play between TIER 2
 * and TIER 3 multiple times in an hour. The stable tier system adds:
 * - Wider tier boundaries with dead zones between tiers
 * - A per-play cache that holds the last assigned tier
 * - Hysteresis: a tier only changes if the new tier is 2+ levels away
 *   OR the risk score moved by 3+ points since last assignment
 */

/**
 * Module-level tier cache for hysteresis.
 * Maps tierCacheKey -> { tier: string, riskScore: number, timestamp: number }
 * Cleared at the start of each MCP tool call to avoid cross-request bleed.
 * @type {Map<string, { tier: string, riskScore: number, timestamp: number }>}
 */
const tierCache = new Map();

/** Max age for cached tier entries (10 minutes). */
const TIER_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Generate a stable cache key for a play from an enriched row.
 * Uses game + selection + market + league to identify a unique play.
 * @param {Object} item — Enriched row
 * @returns {string|null} Cache key or null if insufficient data
 */
function tierCacheKey(item = {}) {
  const row = item.row || item;
  const game = row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`;
  const selection = row.selection || row.participant || row.pick || '';
  const market = row.market || row.playType || row.betType || '';
  const league = row.league || row.sport || row.gameType || '';
  if (!selection) return null;
  return `${league}|${game}|${selection}|${market}`.toLowerCase();
}

/**
 * Clear the tier cache. Called at the start of each MCP tool call
 * so each request computes tiers from scratch but stabilizes within
 * a single multi-league screen (e.g. all_slates across NBA+MLB+NHL).
 */
function clearTierCache() {
  tierCache.clear();
}

/**
 * Purge stale entries from the tier cache (older than TIER_CACHE_MAX_AGE_MS).
 */
function purgeStaleTierCache() {
  const now = Date.now();
  for (const [key, entry] of tierCache) {
    if (now - entry.timestamp > TIER_CACHE_MAX_AGE_MS) {
      tierCache.delete(key);
    }
  }
}

/**
 * Grade the overall movement quality into green/yellow/red.
 *
 * @param {Object} item — Enriched row from rankScreenRows output
 * @returns {string} 'green' | 'yellow' | 'red'
 */
function gradeMovementQuality(item = {}) {
  const movementLabel = String(item.movementLabel || item.movementSummary?.movementLabel || '')
    .trim()
    .toLowerCase();
  const movementQuality = String(item.movementQuality || item.movementSummary?.movementQuality || '')
    .trim()
    .toLowerCase();
  const movementQualityScore = Number(item.movementQualityScore ?? item.movementSummary?.movementQualityScore ?? 0);
  const executionQuality = String(item.executionQuality || '')
    .trim()
    .toLowerCase();
  const consensusBookCount = Number(item.consensusBookCount || 0);
  const steamMove = Boolean(item.steamMove);
  const clvPct = Number(item.clvProxyPct ?? 0);
  const edge = Number(item.consensusEdge ?? -999);
  // multiWindowScore is 0 when there's no line history — don't punish absence of data.
  const multiWindowInsufficientData = Boolean(item.multiWindowInsufficientData);
  const multiWindowScore = multiWindowInsufficientData ? null : Number(item.multiWindowScore ?? 0);

  // Check for RED conditions first (hard fails)
  const adverseMovement = movementLabel === 'adverse';
  const badExecution = executionQuality === 'bad' || executionQuality === 'unknown';
  const thinConsensus = consensusBookCount < 2;
  // Only RED for genuinely adverse signals — insufficient history alone is yellow, not red.
  // Previously this was RED, but it buried ~50% of plays with no history data as TIER 4
  // even when they were coin-flip plays. Now only RED when there's a real negative signal.

  if (adverseMovement || (badExecution && thinConsensus)) {
    return 'red';
  }

  // Check for GREEN conditions (all must pass)
  const supportiveLabel = movementLabel === 'supportive' || movementLabel === 'recent_supportive_only';
  const highQuality = movementQuality === 'high' || movementQualityScore >= 0.8;
  const acceptableExecution = executionQuality === 'best' || executionQuality === 'playable';
  const strongConsensus = consensusBookCount >= 5;
  const strongSteam = steamMove || movementQualityScore >= 0.7;
  const positiveClv = clvPct > 0 || steamMove;
  // Sustained agreement: 4+ of 6 windows with all sharp books moving the same direction.
  // If no multi-window data is available, do not block GREEN — fall back to existing checks.
  const sustainedAgreement = multiWindowInsufficientData || multiWindowScore === null || multiWindowScore >= 0.66;

  if (
    supportiveLabel &&
    highQuality &&
    acceptableExecution &&
    strongConsensus &&
    strongSteam &&
    positiveClv &&
    sustainedAgreement
  ) {
    return 'green';
  }

  // YELLOW — everything else that isn't red
  return 'yellow';
}

/**
 * Calculate a qualitative risk score from 1 (cleanest) to 10 (riskiest).
 *
 * Weighted factors:
 * - Base: 5
 * - Movement quality: green=-2, normal=0, red=+3
 * - Edge: >2%=-1, >0.5%=0, <0.5%=+1, none=+2
 * - Consensus: >=10=-1, >=3=0, <3=+1, <2=+2
 * - Execution quality: best=-1, playable=0, bad/unknown=+2
 * - Steam: supportive steam=-1, no steam=0, adverse steam=+3
 * - CLV: >0=-1, 0..-1=0, <-1=+1, <-3=+2
 *
 * @param {Object} item — Enriched row from rankScreenRows output
 * @returns {number} 1–10 risk score (1 = cleanest)
 */
function calculateRiskScore(item = {}) {
  const movementGrade = gradeMovementQuality(item);
  const movementLabel = String(item.movementLabel || item.movementSummary?.movementLabel || '')
    .trim()
    .toLowerCase();
  const executionQuality = String(item.executionQuality || '')
    .trim()
    .toLowerCase();
  const consensusBookCount = Number(item.consensusBookCount || 0);
  const steamMove = Boolean(item.steamMove);
  const clvPct = Number(item.clvProxyPct ?? 0);
  const edge = Number(item.consensusEdge ?? -999);
  const steamDirection = String(item.steamDirection || '')
    .trim()
    .toLowerCase();
  // multiWindowScore is null when there's no line history — no modifier in that case.
  const multiWindowInsufficientData = Boolean(item.multiWindowInsufficientData);
  const multiWindowScore = multiWindowInsufficientData ? null : Number(item.multiWindowScore ?? 0);

  let score = 5;

  // Movement quality
  if (movementGrade === 'green') score -= 2;
  else if (movementGrade === 'red') score += 3;

  // Edge size
  if (edge > 2) score -= 1;
  else if (edge > 0.5) score += 0;
  else if (edge > 0) score += 1;
  else if (edge === -999 || edge <= 0) score += 2;

  // Consensus depth
  if (consensusBookCount >= 10) score -= 1;
  else if (consensusBookCount >= 5) score += 0;
  else if (consensusBookCount >= 3) score += 1;
  else if (consensusBookCount >= 1) score += 2;
  else score += 3;

  // Execution quality
  if (executionQuality === 'best') score -= 1;
  else if (executionQuality === 'playable') score += 0;
  else score += 2;

  // Steam
  if (steamMove && movementLabel === 'supportive') score -= 1;
  else if (steamMove && steamDirection === 'adverse') score += 3;
  else if (steamMove) score += 0;
  // No steam = neutral, already factored via movement quality

  // CLV
  if (clvPct > 2) score -= 1;
  else if (clvPct > 0) score -= 0.5;
  else if (clvPct > -1) score += 0;
  else if (clvPct > -3) score += 1;
  else score += 2;

  // Multi-window consensus: sustained agreement across time windows.
  // Strong signal (>= 0.66) is a sustained-movement bonus; weak/contradictory (<= 0.33) is a penalty.
  // No data = no modifier (don't punish absence of line history).
  if (multiWindowScore !== null) {
    if (multiWindowScore >= 0.66) score -= 1;
    else if (multiWindowScore <= 0.33) score += 1;
  }

  // Clamp to 1–10 and round
  return Math.round(Math.min(10, Math.max(1, score)));
}

/**
 * Get the Kai call: actionable recommendation based on risk score + grade.
 *
 * @param {Object} item — Enriched row
 * @returns {string} 'BET' | 'CONSIDER' | 'PASS'
 */
function getKaiCall(item = {}) {
  const riskScore = calculateRiskScore(item);
  const grade = gradeMovementQuality(item);

  // Override: red grade always gets PASS regardless of score
  if (grade === 'red') return 'PASS';
  // Green grade + low risk = BET
  if (grade === 'green' && riskScore <= 3) return 'BET';
  // Moderate
  if (riskScore <= 3) return 'BET';
  if (riskScore <= 6) return 'CONSIDER';
  return 'PASS';
}

/**
 * Phase 3: Confidence Tier System
 *
 * TIER 1 — Lock: Green movement, risk 1-2, BET call. No hesitation.
 * TIER 2 — Value: Green risk 3-4, or yellow risk 1-4. Worth a bet.
 * TIER 3 — Speculative: Risk 5-6. Small stake only.
 * TIER 4 — Avoid: Red movement, risk 7+, or PASS call. Skip entirely.
 *
 * Dead zones: Green grade upgrades risk 5-6 from TIER 3 to TIER 2.
 * Red grade or PASS call always forces TIER 4 regardless of score.
 *
 * @param {Object} item — Enriched row
 * @returns {string} 'TIER 1' | 'TIER 2' | 'TIER 3' | 'TIER 4'
 */
function getConfidenceTier(item = {}) {
  const riskScore = calculateRiskScore(item);
  const grade = gradeMovementQuality(item);
  const call = getKaiCall(item);

  // Hard overrides: red grade or PASS always → TIER 4
  if (grade === 'red' || call === 'PASS') return 'TIER 4';

  // Green grade gets a one-tier upgrade (up to TIER 1)
  if (grade === 'green') {
    if (riskScore <= 2) return 'TIER 1';
    if (riskScore <= 4) return 'TIER 2';
    if (riskScore <= 6) return 'TIER 2'; // green upgrade: would be TIER 3, promoted to TIER 2
    return 'TIER 3';
  }

  // Yellow grade (default): wider bands with clear boundaries
  if (riskScore <= 4) return 'TIER 2';
  if (riskScore <= 6) return 'TIER 3';
  return 'TIER 4';
}

/**
 * Stable tier assignment with hysteresis.
 *
 * Solves the "plays keep changing tiers" problem. Small odds movements
 * can flip a play between TIER 2 and TIER 3 repeatedly. This function:
 *
 * 1. Computes the raw tier via getConfidenceTier()
 * 2. Checks if this play was previously assigned a tier (via tierCacheKey)
 * 3. If cached: only updates if the new tier differs by 2+ levels OR
 *    the risk score moved by 3+ points. Otherwise keeps the old tier.
 * 4. Stores the result in cache for the next call.
 *
 * The cache is cleared at the start of each MCP tool call (via clearTierCache),
 * so each request starts fresh but stabilizes within a single multi-league screen.
 *
 * @param {Object} item — Enriched row
 * @returns {string} 'TIER 1' | 'TIER 2' | 'TIER 3' | 'TIER 4'
 */
function getConfidenceTierStable(item = {}) {
  const rawTier = getConfidenceTier(item);
  const rawRisk = calculateRiskScore(item);
  const key = tierCacheKey(item);

  // No cache key available (missing identifiers) — return raw
  if (!key) return rawTier;

  purgeStaleTierCache();
  const cached = tierCache.get(key);

  if (!cached) {
    // First time seeing this play — cache and return
    tierCache.set(key, { tier: rawTier, riskScore: rawRisk, timestamp: Date.now() });
    return rawTier;
  }

  // Tier level numbers for distance calculation
  const tierLevel = { 'TIER 1': 1, 'TIER 2': 2, 'TIER 3': 3, 'TIER 4': 4 };
  const cachedLevel = tierLevel[cached.tier] || 2;
  const rawLevel = tierLevel[rawTier] || 2;
  const tierDistance = Math.abs(rawLevel - cachedLevel);
  const riskDelta = Math.abs(rawRisk - (cached.riskScore || 0));

  // Hysteresis: only update tier if the change is significant
  if (tierDistance >= 2 || riskDelta >= 3) {
    tierCache.set(key, { tier: rawTier, riskScore: rawRisk, timestamp: Date.now() });
    return rawTier;
  }

  // Change is marginal — keep the cached tier
  return cached.tier;
}

/**
 * Build a one-line rationale string for a play.
 *
 * @param {Object} item — Enriched row
 * @returns {string} e.g. "Aliassime: 12 books, 0.99% edge, supportive, best CLV. TIER 2"
 */
function buildRationale(item = {}) {
  const row = item.row || item;
  const name = row.selection || row.participant || row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`;
  const edge = Number(item.consensusEdge ?? 0).toFixed(2);
  const books = Number(item.consensusBookCount || 0);
  const label = String(item.movementLabel || item.movementSummary?.movementLabel || row.movementLabel || '').replace(
    /_/g,
    ' '
  );
  const exec = item.executionQuality || 'unknown';
  const clv = Number(item.clvProxyPct ?? 0).toFixed(2);
  const grade = gradeMovementQuality(item);
  const tier = getConfidenceTier(item);
  const gradeIcon = grade === 'green' ? '🟢' : grade === 'yellow' ? '🟡' : '🔴';

  const parts = [name];
  if (books > 0) parts.push(`${books} books`);
  if (Number(item.consensusEdge) > 0) parts.push(`${edge}% edge`);
  if (label) parts.push(label);
  if (exec && exec !== 'unknown') parts.push(exec);
  if (Number(item.clvProxyPct) !== 0) parts.push(`${clv}% CLV`);

  parts.push(`${gradeIcon} ${tier}`);
  return parts.join(' — ');
}

/**
 * Phase 4: Staking suggestions based on tier and edge.
 *
 * Standard Kelly-fractional approach:
 *   TIER 1: 2.0% of bankroll (high confidence)
 *   TIER 2: 1.0% of bankroll (solid play)
 *   TIER 3: 0.5% of bankroll (speculative)
 *   TIER 4: 0% (avoid)
 *
 * If the edge is known (>0), scales stake proportionally up to 1.5x for
 * edges >2%, and down to 0.5x for edges <0.5%. Caps total exposure per
 * slate at 25% of bankroll. Warns on correlated bets (same game, same
 * league tournament stacking).
 *
 * @param {Object} options
 * @param {number} options.bankroll — Total bankroll in dollars
 * @param {Array} options.plays — Array of play objects with confidenceTier, consensusEdge, league, game, selection
 * @returns {Object} Staking plan
 */
function suggestStakes({ bankroll = 1000, plays = [] } = {}) {
  if (!Number.isFinite(bankroll) || bankroll <= 0) {
    return { ok: false, error: 'bankroll must be a positive number' };
  }
  if (!Array.isArray(plays) || !plays.length) {
    return { ok: true, totalStake: 0, stakes: [], warnings: ['No plays to stake'] };
  }

  const tierMultiplier = { 'TIER 1': 2.0, 'TIER 2': 1.0, 'TIER 3': 0.5, 'TIER 4': 0 };
  const stakes = [];
  let totalStakePct = 0;
  const warnings = [];
  const gameKeys = new Map(); // game -> count for correlation detection

  for (const play of plays) {
    const tier = play.confidenceTier || getConfidenceTier(play);
    const edge = Number(play.consensusEdge ?? 0);
    // Treat explicit null/undefined/missing as "no data"; treat 0 as the literal value.
    const rawClv = play.clvProxyPct;
    const hasClv = rawClv !== null && rawClv !== undefined && Number.isFinite(Number(rawClv));
    const clv = hasClv ? Number(rawClv) : null;
    const basePct = tierMultiplier[tier] || 0;
    if (basePct <= 0) continue;

    // Scale by edge
    let edgeFactor = 1.0;
    if (edge > 2) edgeFactor = 1.5;
    else if (edge > 1) edgeFactor = 1.25;
    else if (edge < 0.5) edgeFactor = 0.5;

    // Scale by CLV: a TIER 1 play with +6% CLV is meaningfully different from
    // a TIER 1 play with +0.5% CLV. Bonus for strong CLV, penalty for weak/null.
    let clvFactor;
    let clvBucket;
    if (!hasClv) {
      clvFactor = 0.5;
      clvBucket = 'no_data';
    } else if (clv >= 5) {
      clvFactor = 1.5;
      clvBucket = 'strong_5plus';
    } else if (clv >= 2) {
      clvFactor = 1.0;
      clvBucket = 'moderate_2to5';
    } else if (clv >= 0.5) {
      clvFactor = 0.75;
      clvBucket = 'weak_0_5to2';
    } else {
      clvFactor = 0.5;
      clvBucket = 'sub_threshold';
    }

    let stakePct = basePct * edgeFactor * clvFactor;
    // Clamp per-play max
    stakePct = Math.min(stakePct, 5.0);

    const stakeDollars = (bankroll * stakePct) / 100;
    totalStakePct += stakePct;

    // Track games for correlation detection
    const gameKey = play.game || play.selection || `${play.awayTeam} @ ${play.homeTeam}`;
    const sportKey = `${play.league || '?'}:${gameKey}`;
    gameKeys.set(sportKey, (gameKeys.get(sportKey) || 0) + 1);

    stakes.push({
      game: gameKey,
      selection: play.selection || play.participant || null,
      league: play.league || null,
      tier,
      edge: edge > 0 ? `${edge.toFixed(2)}%` : null,
      clvPct: hasClv ? Number(clv.toFixed(2)) : null,
      clvBucket,
      clvFactor,
      edgeFactor,
      basePct,
      bankrollPct: Number(stakePct.toFixed(2)),
      stakeDollars: Math.round(stakeDollars),
      rationale: play.rationale || buildRationale(play)
    });
  }

  // Warn on total exposure
  if (totalStakePct > 25) {
    warnings.push(
      `Total exposure ${totalStakePct.toFixed(1)}% exceeds 25% recommended cap. Consider reducing position sizes.`
    );
  }

  // Warn on correlated bets (same game, multiple sides)
  for (const [key, count] of gameKeys) {
    if (count > 1) {
      warnings.push(
        `Correlated bets detected on ${key} (${count} legs). These move together — consider picking one side.`
      );
    }
  }

  const totalStake = stakes.reduce((sum, s) => sum + s.stakeDollars, 0);

  return {
    ok: true,
    bankroll,
    totalStake,
    totalStakePct: Number(totalStakePct.toFixed(2)),
    remainingBankroll: bankroll - totalStake,
    playCount: stakes.length,
    stakes,
    warnings
  };
}

module.exports = {
  gradeMovementQuality,
  calculateRiskScore,
  getKaiCall,
  getConfidenceTier,
  getConfidenceTierStable,
  clearTierCache,
  buildRationale,
  suggestStakes
};
