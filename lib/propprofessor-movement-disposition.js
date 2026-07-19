'use strict';

/**
 * Synthesize a single movement-disposition string from the raw grade, direction,
 * and label fields. Any agent reads this ONE field instead of cross-referencing
 * movementGrade + recentSharpMoveDirection + movementLabel + peakAdverseClvPct.
 *
 * Returns one of:
 *   "supportive_clean"      — green grade + supportive label + supportive recent. BET confidently.
 *   "supportive_bouncy"     — yellow grade + supportive recent. Direction is right but path was rocky. Playable. CONSIDER.
 *   "adverse_recent"        — recent direction is against. PASS regardless of full-window label.
 *   "adverse_full"          — full-window direction against + red/yellow grade. PASS.
 *   "insufficient"          — not enough data. Cannot evaluate. PASS or skip.
 *
 *   NOTE: if `row.sharpBookMovementConfirmed` is true (independent sharp book
 *   moved on this side), an otherwise `insufficient` disposition is upgraded to
 *   `supportive_bouncy` — the sharp confirmation tells us the direction even
 *   when the in-row line history is too thin to grade. Adverse dispositions are
 *   never overridden by confirmation.
 *
 * @param {Object|null} row - Enriched screen row with movement fields.
 * @returns {string} One of the above disposition strings.
 */
function computeMovementDisposition(row) {
  if (!row || typeof row !== 'object') return 'insufficient';

  const grade = String(row.movementGrade || '').toLowerCase();
  const fullLabel = String(row.movementLabel || '').toLowerCase();
  const recentDir = String(row.recentSharpMoveDirection || '').toLowerCase();
  const fullDir = String(row.fullWindowSharpMoveDirection || '').toLowerCase();
  const sharpConfirmed = Boolean(row.sharpBookMovementConfirmed);

  // When independent sharp money confirmed this side but the in-row line
  // history is too thin to grade, surface it as supportive_bouncy (playable,
  // direction known via the independent sharp book) instead of "can't tell".
  // Adverse dispositions below are intentionally NOT overridden — if the
  // recent in-row direction went against the play, that wins.
  const insufficient = () => (sharpConfirmed ? 'supportive_bouncy' : 'insufficient');

  // 1. Red grade = full direction is adverse regardless of label
  if (grade === 'red') return 'adverse_full';

  // 2. Insufficient history — can't evaluate
  if (recentDir === 'insufficient_history' && fullDir === 'insufficient_history') return insufficient();
  if (fullLabel === 'insufficient_history') return insufficient();

  // 2a. CLV-sign guard: when direction fields are missing and the label is
  //     supportive but the raw CLV is negative, the label is misleading.
  //     This catches leagues (e.g. NBASL) where the feed has thin or missing
  //     line history but still stamps a supportive label on both sides of
  //     a binary market. A negative CLV means odds moved against this side.
  const hasDirectionData = Boolean(recentDir || fullDir);
  const isLabelSupportive = fullLabel === 'supportive' || fullLabel === 'recent_supportive_only';
  if (isLabelSupportive && !hasDirectionData) {
    const clv = Number(row.openToCurrentClvPct ?? row.clvProxyPct ?? row.clv);
    if (Number.isFinite(clv) && clv < -0.01) {
      return 'adverse_full';
    }
  }

  // 3. Recent direction is adverse = auto-PASS, even if full window looks fine
  if (recentDir === 'adverse') return 'adverse_recent';

  // 4. Full-window recent_supportive_only means the early window was mixed
  //    but recent is good. This is borderline.
  if (fullLabel === 'recent_supportive_only') {
    if (grade === 'green') return 'supportive_clean';
    return 'supportive_bouncy';
  }

  // 5. Full label is adverse means early window direction was wrong
  if (fullLabel === 'adverse') return 'adverse_full';

  // 6. Full label is supportive + green grade = clean.
  //    Check for V-shaped recovery: if CLV dipped adverse mid-window but recovered,
  //    even a green grade should be treated as bouncy.
  if (fullLabel === 'supportive' && grade === 'green') {
    const peakAdverse = Number(row.peakAdverseClvPct);
    if (Number.isFinite(peakAdverse) && peakAdverse < -2) {
      return 'supportive_bouncy';
    }
    return 'supportive_clean';
  }

  // 7. Full label is supportive + yellow grade = bouncy but direction is right
  if (fullLabel === 'supportive' && grade === 'yellow') return 'supportive_bouncy';

  // 8. Label is "mixed" — some windows agree, some don't
  if (fullLabel === 'mixed') {
    if (recentDir === 'supportive') return 'supportive_bouncy';
    if (recentDir === 'adverse') return 'adverse_recent';
    return insufficient();
  }

  // 9. Fallback for anything we didn't pattern-match
  return insufficient();
}

module.exports = { computeMovementDisposition };
