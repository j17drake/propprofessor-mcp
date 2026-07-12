'use strict';

/**
 * Reconcile screen-snapshot signals against validate-path re-derivations.
 *
 * The validate path (runValidatePlayImpl) re-fetches and re-derives
 * executionQuality + movementDisposition a few seconds after the screen
 * snapshot, using PP-feed values + computeMovementDisposition on a fresh
 * snapshot. It has historically SILENTLY overridden the screen's clean
 * signal even when nothing material changed (re-derivation noise / a
 * different classifier). This helper keeps the screen's signal unless the
 * re-fetch shows a REAL, explainable change (consensus actually drifted).
 *
 * @param {Object} a
 * @param {string} a.screenExec        executionQuality from the screen snapshot
 * @param {string} a.screenDisposition movementDisposition from the screen snapshot
 * @param {string} a.validateExec      executionQuality from the validate re-fetch
 * @param {string} a.validateDisposition movementDisposition from the validate re-fetch
 * @param {boolean} a.consensusDrift   already-computed screen-vs-refetch drift flag
 * @returns {{executionQuality:string, movementDisposition:string, overridden:boolean, reason:string}}
 */
function reconcileValidateOverride({
  screenExec = 'unknown',
  screenDisposition = 'insufficient',
  validateExec = 'unknown',
  validateDisposition = 'insufficient',
  consensusDrift = false
} = {}) {
  let overridden = false;
  const reasons = [];

  // --- executionQuality ---
  // Screen used our classifier (classifyExecutionQuality): 'bad' only when
  // >300c off-market. If validate says 'bad' but screen said playable/best
  // and consensus did NOT drift, the validate 'bad' is unconfirmed — keep
  // the screen signal.
  let executionQuality = validateExec;
  const screenAcceptable = screenExec === 'playable' || screenExec === 'best';
  if (validateExec === 'bad' && screenAcceptable && !consensusDrift) {
    executionQuality = screenExec;
    overridden = true;
    reasons.push('validate bad contradicted screen ' + screenExec + '; no consensus drift; kept screen signal');
  }

  // --- movementDisposition ---
  // Keep the screen disposition unless validate shows adverse AND consensus
  // actually drifted (real support moved). Without drift, an adverse flip on
  // re-derivation is noise.
  const adverse = (d) => String(d).startsWith('adverse');
  const screenAdverse = adverse(screenDisposition);
  const validateAdverse = adverse(validateDisposition);
  let movementDisposition = validateDisposition;
  if (validateAdverse && !screenAdverse && !consensusDrift) {
    movementDisposition = screenDisposition;
    overridden = true;
    reasons.push('adverse disposition on re-fetch without consensus drift; kept screen signal');
  }

  return {
    executionQuality,
    movementDisposition,
    overridden,
    reason: reasons.join('; ') || 'screen and validate agree'
  };
}

module.exports = { reconcileValidateOverride };
