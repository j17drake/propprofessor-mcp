'use strict';

/**
 * Map a sharp_plays / ranker row to the quick_screen candidate output shape.
 * Single source of truth for the candidate field set used by quick_screen.
 *
 * @param {Object} row - Ranker row from sharp_plays output
 * @returns {Object} Standardized candidate object
 */
function mapCandidateRow(row = {}) {
  const staleMovementWarning =
    String(row.movementDisposition || '').startsWith('adverse') &&
    (row.confidenceTier === 'TIER 1' || row.confidenceTier === 'TIER 2') &&
    (Number(row.consensusBookCount) || 0) >= 10;

  const displayTier = row.kaiCall === 'BET' ? 'BET' : row.kaiCall === 'CONSIDER' ? 'CONSIDER' : 'PASS';

  return {
    playId: row.playId || null,
    selectionKey: row.selectionKey || null,
    gameId: row.gameId || null,
    game: row.game || `${row.awayTeam || '?'} @ ${row.homeTeam || '?'}`,
    selection: row.selection || row.participant || row.pick || null,
    start: row.start || null,
    startCST: row.start
      ? (() => {
          // Handle both ISO strings (from API) and epoch seconds
          const ts = typeof row.start === 'string' ? Date.parse(row.start) : Number(row.start) * 1000;
          if (!Number.isFinite(ts)) return null;
          const d = new Date(ts);
          try {
            return new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }).format(d);
          } catch { return null; }
        })()
      : null,
    odds: row.odds ?? row.targetBookOdds ?? row.currentOdds ?? row.bestAvailableOdds ?? (row.lineHistory?.[0]?.odds) ?? null,
    edge: row.consensusEdge ?? null,
    edgeSanityFlag: row.edgeSanityFlag ?? 'ok',
    clv: row.clvProxyPct ?? null,
    consensusBookCount: row.consensusBookCount ?? 0,
    executionQuality: row.executionQuality ?? 'unknown',
    movementGrade: row.movementGrade ?? 'unknown',
    movementLabel: row.movementLabel ?? null,
    sharpBookMovementConfirmed: row.sharpBookMovementConfirmed || false,
    sharpBookMovementSource: row.sharpBookMovementSource || null,
    riskScore: row.riskScore ?? null,
    kaiCall: row.kaiCall ?? 'PASS',
    confidenceTier: row.confidenceTier ?? 'TIER 4',
    rationale: row.rationale || null,
    screenScore: row.screenScore ?? 0,
    freshnessSource: row.freshnessSource ?? null,
    movementDisposition: row.movementDisposition || 'insufficient',
    staleMovementWarning,
    displayTier,
    hoursUntilStart: row.start ? Math.round(((new Date(row.start).getTime() - Date.now()) / 3600000) * 10) / 10 : null
  };
}

module.exports = { mapCandidateRow };
