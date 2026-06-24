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
 * @param {Object|null} row - Enriched screen row with movement fields.
 * @returns {string} One of the above disposition strings.
 */
function computeMovementDisposition(row) {
  if (!row || typeof row !== 'object') return 'insufficient';

  const grade = String(row.movementGrade || '').toLowerCase();
  const fullLabel = String(row.movementLabel || '').toLowerCase();
  const recentDir = String(row.recentSharpMoveDirection || '').toLowerCase();
  const fullDir = String(row.fullWindowSharpMoveDirection || '').toLowerCase();

  // 1. Red grade = full direction is adverse regardless of label
  if (grade === 'red') return 'adverse_full';

  // 2. Insufficient history — can't evaluate
  if (recentDir === 'insufficient_history' && fullDir === 'insufficient_history') return 'insufficient';
  if (fullLabel === 'insufficient_history') return 'insufficient';

  // 3. Recent direction is adverse = auto-PASS, even if full window looks fine
  //    (V-shaped recovery where endpoints look good but the line dipped recently)
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
    return 'insufficient';
  }

  // 9. Fallback for anything we didn't pattern-match
  return 'insufficient';
}

module.exports = { computeMovementDisposition };
