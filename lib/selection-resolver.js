'use strict';

/**
 * Selection Resolver — extracts selection/odds resolution logic from screen-ranker.
 *
 * Handles the complex task of finding the correct selection and odds side
 * from a row's selections map, using selection ID, book/odds/line matching,
 * or default key ordering.
 */

/**
 * Get the primary selection from a row's selections map.
 * @param {Object} row - Row data with selections map.
 * @returns {Object|null} Selection object or null.
 */
function getScreenSelection(row) {
  if (!row || typeof row !== 'object') return null;
  const selections = row.selections;
  if (!selections || typeof selections !== 'object') return null;
  const preferredKey = row.defaultKey != null ? String(row.defaultKey) : null;
  if (preferredKey && selections[preferredKey]) return selections[preferredKey];
  const keys = Object.keys(selections);
  return keys.length ? selections[keys[0]] : null;
}

/**
 * Resolve the correct selection from a row, using selection ID, book/odds/line matching, or default key order.
 * @param {Object} row - Row data with selections map and identifiers.
 * @returns {Object|null} Resolved selection object or null.
 */
function getResolvedScreenSelection(row) {
  if (!row || typeof row !== 'object') return null;
  const selections = row.selections;
  if (!selections || typeof selections !== 'object') return null;

  const selectionEntries = Object.entries(selections);
  const selectionId = String(row.selectionId || row.selection_id || row.selectionID || '').trim();
  if (selectionId) {
    const exactSelectionEntry = selectionEntries.find(([, selection]) => {
      const leftId = String(selection?.selection1Id || '').trim();
      const rightId = String(selection?.selection2Id || '').trim();
      return leftId === selectionId || rightId === selectionId;
    });
    if (exactSelectionEntry) return exactSelectionEntry[1];
  }

  const preferredBook = String(row.book || row.sportsbook || '').trim();
  const currentOdds = row.currentOdds ?? row.odds;
  const currentLine = row.line;
  if (preferredBook && currentOdds != null && currentLine != null) {
    const exactLineEntry = selectionEntries.find(([, selection]) => {
      const preferredOdds = selection?.odds?.[preferredBook];
      if (!preferredOdds || typeof preferredOdds !== 'object') return false;
      const candidatePairs = [
        { line: selection?.line1, odds: preferredOdds.odds1 },
        { line: selection?.line2, odds: preferredOdds.odds2 }
      ];
      return candidatePairs.some(
        (candidate) => String(candidate.line) === String(currentLine) && String(candidate.odds) === String(currentOdds)
      );
    });
    if (exactLineEntry) return exactLineEntry[1];
  }

  const preferredKey = row.defaultKey != null ? String(row.defaultKey) : null;
  const orderedSelections = [
    ...(preferredKey && selections[preferredKey] ? [selections[preferredKey]] : []),
    ...selectionEntries.filter(([key]) => !preferredKey || key !== preferredKey).map(([, selection]) => selection)
  ];

  for (const selection of orderedSelections) {
    if (resolveExtractedScreenSide(row, selection)) return selection;
  }

  return orderedSelections[0] || null;
}

/**
 * Resolve which side (odds1 or odds2) matches a row's selection criteria.
 * Matches by selectionId, participant name, or odds value.
 * @param {Object} row - Row data with selectionId, participant, book, currentOdds.
 * @param {Object} selection - Selection object with selection1/2, participant1/2, odds1/2.
 * @returns {{ oddsKey: string, selectionLabel: string, participant: string, odds: number }|null}
 */
function resolveExtractedScreenSide(row, selection) {
  if (!row || typeof row !== 'object' || !selection || typeof selection !== 'object') return null;
  const selectionId = String(row.selectionId || row.selection_id || row.selectionID || '').trim();
  const participant = String(row.participant || row.selection || row.pick || '')
    .trim()
    .toLowerCase();
  const preferredBook = String(row.book || row.sportsbook || '').trim();
  const preferredOdds = selection?.odds?.[preferredBook];
  const currentOdds = row.currentOdds ?? row.odds;
  const candidateSides = [
    {
      oddsKey: 'odds1',
      selectionId: String(selection.selection1Id || '').trim(),
      selectionLabel: selection.selection1 || selection.participant1,
      participant: String(selection.participant1 || selection.selection1 || '')
        .trim()
        .toLowerCase(),
      odds: preferredOdds?.odds1
    },
    {
      oddsKey: 'odds2',
      selectionId: String(selection.selection2Id || '').trim(),
      selectionLabel: selection.selection2 || selection.participant2,
      participant: String(selection.participant2 || selection.selection2 || '')
        .trim()
        .toLowerCase(),
      odds: preferredOdds?.odds2
    }
  ];

  if (selectionId) {
    const exactSelectionMatch = candidateSides.find((side) => side.selectionId && side.selectionId === selectionId);
    if (exactSelectionMatch) return exactSelectionMatch;
  }

  if (participant) {
    const participantMatch = candidateSides.find((side) => side.participant && side.participant === participant);
    if (participantMatch) return participantMatch;
  }

  if (preferredOdds && currentOdds != null) {
    const oddsMatch = candidateSides.find((side) => side.odds != null && String(side.odds) === String(currentOdds));
    if (oddsMatch) return oddsMatch;
  }

  return null;
}

/**
 * Resolve the odds map for a row, handling both lifted (allBookOdds) and
 * nested (selections.null.odds) shapes.
 * @param {Object} row - Row data.
 * @returns {Object|null} The odds map, or null if no odds are available.
 */
function oddsMapForRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.allBookOdds && typeof row.allBookOdds === 'object') return row.allBookOdds;
  const selection = getResolvedScreenSelection(row) || getScreenSelection(row);
  return selection?.odds || null;
}

module.exports = {
  getScreenSelection,
  getResolvedScreenSelection,
  resolveExtractedScreenSide,
  oddsMapForRow
};
