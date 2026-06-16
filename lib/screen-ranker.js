'use strict';

const { getSharpBookComparisonSet, getSharpBookContext } = require('./propprofessor-sharp-books');
const { summarizeSharpMovement } = require('./propprofessor-sharp-history');
const { detectSteamMove } = require('./propprofessor-steam-move');
const { computeMultiWindowScore } = require('./propprofessor-sharp-consensus');
const {
  gradeMovementQuality,
  calculateRiskScore,
  getKaiCall,
  getConfidenceTierStable,
  getTierTrajectory,
  buildRationale
} = require('./propprofessor-risk-score');
const {
  americanOddsToImpliedProbability,
  matchesPreferredBook,
  normalizeLeagueName,
  normalizeMarketName
} = require('./propprofessor-shared-utils');
const { extractHistoryTrail, extractNumericTrailValue, extractRowFreshnessInfo } = require('./screen-parser');
const {
  classifyConsensusStrength,
  classifyExecutionQuality,
  summarizeComparisonBooks,
  summarizeSupportBooks
} = require('./screen-summary');

/**
 * Get the tennis market name from a row, normalized.
 * @param {Object} row - Row data with market/selection/playType fields.
 * @returns {string} Normalized market name.
 */
function getTennisMarketName(row) {
  return normalizeMarketName(row?.market || row?.selection || row?.playType || row?.betType || '');
}

/**
 * Calculate the average of an array of finite numbers.
 * @param {number[]} values - Array of numeric values.
 * @returns {number|null} Average or null if no finite values exist.
 */
function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/**
 * Get the ranking preset configuration for a league and market combination.
 * Each league has configurable minimum scores, preferred books, and market priorities.
 * @param {string} league - League name.
 * @param {string} market - Market name.
 * @returns {Object} League ranking preset with league, displayName, preferredBooks, minimumScore, marketPriorities.
 */
function getLeagueRankingPreset(league, market) {
  const normalizedLeague = normalizeLeagueName(league);
  const sharpBooks = getSharpBookComparisonSet({ league: normalizedLeague, market });
  const sharpContext = getSharpBookContext({ league: normalizedLeague, market });
  const presets = {
    NBA: {
      league: 'NBA',
      displayName: 'NBA',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 2.0,
      marketPriorities: [
        { match: 'player points', weight: 2.5 },
        { match: 'player rebounds', weight: 2.2 },
        { match: 'player assists', weight: 2.2 },
        { match: 'player pra', weight: 2.6 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    MLB: {
      league: 'MLB',
      displayName: 'MLB',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 2.05,
      marketPriorities: [
        { match: 'player strikeouts', weight: 2.6 },
        { match: 'player outs', weight: 2.5 },
        { match: 'player hits', weight: 2.2 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'run line', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    NFL: {
      league: 'NFL',
      displayName: 'NFL',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 2.0,
      marketPriorities: [
        { match: 'player passing yards', weight: 2.5 },
        { match: 'player rushing yards', weight: 2.4 },
        { match: 'player receptions', weight: 2.3 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    NHL: {
      league: 'NHL',
      displayName: 'NHL',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'player shots', weight: 2.4 },
        { match: 'player points', weight: 2.1 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'puck line', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    SOCCER: {
      league: 'SOCCER',
      displayName: 'Soccer',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'moneyline', weight: 1.6 },
        { match: 'spread', weight: 1.6 },
        { match: 'total', weight: 1.6 },
        { match: 'goal scorer', weight: 2.3 },
        { match: 'shots', weight: 2.0 },
        { match: 'corners', weight: 1.9 }
      ]
    },
    TENNIS: {
      league: 'TENNIS',
      displayName: 'Tennis',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.9,
      marketPriorities: [
        { match: 'moneyline', weight: 1.7 },
        { match: 'game handicap', weight: 2.2 },
        { match: 'set handicap', weight: 2.4 },
        { match: 'point spread', weight: 2.1 },
        { match: 'total sets', weight: 2.0 },
        { match: 'total games', weight: 1.8 }
      ]
    },
    UFC: {
      league: 'UFC',
      displayName: 'UFC',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.8,
      marketPriorities: [
        { match: 'moneyline', weight: 1.8 },
        { match: 'total rounds', weight: 1.8 },
        { match: 'method of victory', weight: 1.8 },
        { match: 'fight goes the distance', weight: 1.8 },
        { match: 'spread', weight: 1.8 }
      ]
    },
    NCAAB: {
      league: 'NCAAB',
      displayName: 'NCAAB',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'player points', weight: 2.3 },
        { match: 'player rebounds', weight: 2.1 },
        { match: 'player assists', weight: 2.1 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    NCAAF: {
      league: 'NCAAF',
      displayName: 'NCAAF',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.9,
      marketPriorities: [
        { match: 'player passing yards', weight: 2.4 },
        { match: 'player rushing yards', weight: 2.3 },
        { match: 'player receptions', weight: 2.2 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    },
    WNBA: {
      league: 'WNBA',
      displayName: 'WNBA',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.9,
      marketPriorities: [
        { match: 'player points', weight: 2.5 },
        { match: 'player rebounds', weight: 2.2 },
        { match: 'player assists', weight: 2.2 },
        { match: 'player pra', weight: 2.6 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    }
  };
  return (
    presets[normalizedLeague] || {
      league: normalizedLeague || 'NBA',
      displayName: normalizedLeague || 'NBA',
      preferredBooks: sharpBooks,
      sharpBookContext: sharpContext,
      minimumScore: 1.75,
      marketPriorities: [
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.5 }
      ]
    }
  );
}

/**
 * Check if a row passes the league ranking gate (minimum score threshold + signal requirement).
 * @param {{ score: number, hasConsensus: boolean, hasLineMovement: boolean, leaguePreset: Object, marketHintMatch: string|null }} params - Gate parameters.
 * @returns {{ passed: boolean, reason: string }}
 */
function passesLeagueRankingGate({ score, hasConsensus, hasLineMovement, leaguePreset, marketHintMatch }) {
  const minimumScore = Number(leaguePreset?.minimumScore);
  const hardFloor = Number.isFinite(minimumScore) ? minimumScore : 1.75;
  const hasSignal = Boolean(hasConsensus || hasLineMovement || marketHintMatch);
  if (!hasSignal) {
    return { passed: false, reason: 'no consensus, CLV, or market fit signal' };
  }
  if (!Number.isFinite(score)) {
    return { passed: false, reason: 'score unavailable' };
  }
  if (score < hardFloor) {
    return { passed: false, reason: `score ${score.toFixed(2)} below ${hardFloor.toFixed(2)} gate` };
  }
  return { passed: true, reason: `score ${score.toFixed(2)} passed ${hardFloor.toFixed(2)} gate` };
}

/**
 * Get the market priority score for a market within a league preset.
 * @param {Object} preset - League ranking preset with marketPriorities array.
 * @param {string} marketText - Market name text to match.
 * @returns {{ match: string, weight: number }|null} Matching priority entry or null.
 */
function getMarketPriorityScore(preset, marketText) {
  const normalizedMarket = String(marketText || '').toLowerCase();
  const priority = (preset?.marketPriorities || []).find((item) => normalizedMarket.includes(item.match));
  return priority || null;
}

/**
 * Filter rows by league name.
 * @param {Array<Object>} rows - Array of row objects with league/sport/gameType fields.
 * @param {string} league - League name to filter by.
 * @returns {Array<Object>} Filtered rows.
 */
function filterRowsByLeague(rows, league) {
  const normalizedLeague = normalizeLeagueName(league);
  if (!normalizedLeague) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const rowLeague = normalizeLeagueName(row.league || row.sport || row.gameType || '');
    if (rowLeague === normalizedLeague) return true;
    return false;
  });
}

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
 * Expand a screen row by resolving book, selection, side, and computing consensus/probability data.
 * @param {Object} row - Row data.
 * @param {{ preferredBook: string }} [options={}] - Options with preferred book name.
 * @returns {Array<Object>} Expanded row(s) with computed fields.
 */
function expandScreenRow(row, { preferredBook = 'NoVigApp', requirePreferredBook = false } = {}) {
  // v2.1.6: extractScreenRows produces per-book rows from a normalized
  // upstream payload (selections.null was lifted to the top level, and
  // the full odds map was overridden with the per-book number). The ranker
  // reads row.selections to find the full map; when that's undefined we
  // reconstruct the lifted shape from the top-level fields + allBookOdds
  // so the main path can find the map and compute real consensus.
  if (!row?.selections && row?.allBookOdds && typeof row.allBookOdds === 'object') {
    row = {
      ...row,
      selections: {
        null: {
          selection1: row.selection1,
          participant1: row.participant1,
          selectionType1: row.selectionType1,
          selection1Id: row.selection1Id,
          line1: row.line1,
          selection2: row.selection2,
          participant2: row.participant2,
          selectionType2: row.selectionType2,
          selection2Id: row.selection2Id,
          line2: row.line2,
          odds: row.allBookOdds
        }
      }
    };
  }
  if (row?.selections && (row?.book || row?.sportsbook)) {
    const rowBook = String(row.book || row.sportsbook || '').trim();
    const selection = getResolvedScreenSelection(row);
    const oddsMap = selection?.odds || {};
    const preferredAvailable = Boolean(oddsMap?.[preferredBook]);
    if (preferredAvailable && rowBook && rowBook !== preferredBook) {
      return [];
    }
    // Audit 2026-06-15: when the user explicitly asked for a specific book
    // (e.g. books: ['Fliff']) and that book doesn't have a price in the
    // expanded row's oddsMap, drop the row entirely. Without this check the
    // ranker falls through to oddsMap?.[rowBook] (the row's source book) and
    // reports a non-preferred book's odds as if they were the preferred book's
    // — a misleading "Barton -117 on Fliff" that is actually Pinnacle's line.
    if (requirePreferredBook && !preferredAvailable) {
      return [];
    }
    const resolvedBook = preferredAvailable ? preferredBook : rowBook || preferredBook;
    const preferredOdds =
      oddsMap?.[resolvedBook] || oddsMap?.[preferredBook] || oddsMap?.[rowBook] || oddsMap?.NoVigApp;
    const side = resolveExtractedScreenSide(row, selection);
    if (!preferredOdds || !side) {
      return [{ ...row, book: resolvedBook }];
    }

    const compBooks = Object.entries(oddsMap || {})
      .filter(([book]) => book !== resolvedBook)
      .map(([book, odds]) => ({ book, odds: odds || {} }));
    const preferredProb = americanOddsToImpliedProbability(preferredOdds[side.oddsKey]);
    const consensusProb = average(compBooks.map((item) => americanOddsToImpliedProbability(item.odds[side.oddsKey])));
    const hasConsensus = Number.isFinite(preferredProb) && Number.isFinite(consensusProb);
    const marketSummary = summarizeComparisonBooks(compBooks, side.oddsKey);
    const supportSummary = summarizeSupportBooks(compBooks, side.oddsKey);
    const targetBookOdds = preferredOdds[side.oddsKey];
    const comparisonOdds = compBooks.map((item) => item.odds[side.oddsKey]);
    const finiteComparisonOdds = comparisonOdds.filter(Number.isFinite);
    const bestAvailableOdds = finiteComparisonOdds.length ? Math.max(...finiteComparisonOdds) : null;
    const executionQuality = classifyExecutionQuality({ targetOdds: targetBookOdds, comparisonOdds });

    return [
      {
        ...row,
        participant: side.selectionLabel || row.participant || '',
        selection: side.selectionLabel || row.selection || row.pick || '',
        pick: side.selectionLabel || row.pick || row.selection || '',
        book: resolvedBook,
        odds: preferredOdds[side.oddsKey],
        currentOdds: preferredOdds[side.oddsKey],
        consensusEdge: hasConsensus ? (consensusProb - preferredProb) * 100 : null,
        hasConsensus,
        // Backward-compatibility field. This is narrower than raw market availability.
        consensusBookCount: compBooks.filter((item) =>
          Number.isFinite(americanOddsToImpliedProbability(item.odds[side.oddsKey]))
        ).length,
        consensusStrength: classifyConsensusStrength(
          compBooks.filter((item) => Number.isFinite(americanOddsToImpliedProbability(item.odds[side.oddsKey]))).length
        ),
        marketBookCount: marketSummary.marketBookCount,
        marketBooks: marketSummary.marketBooks,
        supportBookCount: supportSummary.supportBookCount,
        supportBooks: supportSummary.supportBooks,
        targetBookOdds,
        bestAvailableOdds,
        executionQuality
      }
    ];
  }

  const selection = getScreenSelection(row);
  const oddsMap = selection?.odds;
  const preferredOdds = oddsMap?.[preferredBook] || oddsMap?.NoVigApp;
  if (!preferredOdds) return [row];

  const compBooks = Object.entries(oddsMap)
    .filter(([book]) => book !== preferredBook)
    .map(([book, odds]) => ({ book, odds: odds || {} }));

  function buildSide(selectionLabel, fallbackParticipant, oddsKey) {
    const preferredProb = americanOddsToImpliedProbability(preferredOdds[oddsKey]);
    const consensusProb = average(compBooks.map((item) => americanOddsToImpliedProbability(item.odds[oddsKey])));
    const hasConsensus = Number.isFinite(preferredProb) && Number.isFinite(consensusProb);
    const marketSummary = summarizeComparisonBooks(compBooks, oddsKey);
    const supportSummary = summarizeSupportBooks(compBooks, oddsKey);
    const targetBookOdds = preferredOdds[oddsKey];
    const comparisonOdds = compBooks.map((item) => item.odds[oddsKey]);
    const finiteComparisonOdds = comparisonOdds.filter(Number.isFinite);
    const bestAvailableOdds = finiteComparisonOdds.length ? Math.max(...finiteComparisonOdds) : null;
    const executionQuality = classifyExecutionQuality({ targetOdds: targetBookOdds, comparisonOdds });
    return {
      ...row,
      participant: selectionLabel || fallbackParticipant || '',
      book: preferredBook,
      odds: preferredOdds[oddsKey],
      currentOdds: preferredOdds[oddsKey],
      consensusEdge: hasConsensus ? (consensusProb - preferredProb) * 100 : null,
      hasConsensus,
      // Backward-compatibility field. This is narrower than raw market availability.
      consensusBookCount: compBooks.filter((item) =>
        Number.isFinite(americanOddsToImpliedProbability(item.odds[oddsKey]))
      ).length,
      consensusStrength: classifyConsensusStrength(
        compBooks.filter((item) => Number.isFinite(americanOddsToImpliedProbability(item.odds[oddsKey]))).length
      ),
      marketBookCount: marketSummary.marketBookCount,
      marketBooks: marketSummary.marketBooks,
      supportBookCount: supportSummary.supportBookCount,
      supportBooks: supportSummary.supportBooks,
      targetBookOdds,
      bestAvailableOdds,
      executionQuality
    };
  }

  return [
    buildSide(selection?.selection1 || selection?.participant1, row.participant || row.homeTeam, 'odds1'),
    buildSide(selection?.selection2 || selection?.participant2, row.awayTeam, 'odds2')
  ];
}

/**
 * Rank screen rows by scoring, gating, and sorting based on consensus edge, line movement, freshness, and market priority.
 * @param {Array<Object>} rows - Array of row data.
 * @param {Object} [options={}] - Ranking options.
 * @param {number} [options.limit=12] - Max rows to return.
 * @param {string[]} [options.preferredBooks] - Ordered list of preferred books.
 * @param {boolean} [options.includeAll=false] - Include rows that don't pass the ranking gate.
 * @param {number|null} [options.maxAgeMs=null] - Staleness threshold in ms.
 * @param {number} [options.recentWindowHours=6] - Recent movement window in hours.
 * @param {boolean} [options.debug=true] - Include debug payload in results.
 * @returns {Array<Object>} Ranked and enriched rows.
 */
function rankScreenRows(
  rows,
  {
    limit = 12,
    preferredBooks = ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
    includeAll = false,
    maxAgeMs = null,
    recentWindowHours = 6,
    debug = true,
    requirePreferredBook = false,
    playableOnly = false
  } = {}
) {
  const preferredBook = Array.isArray(preferredBooks) && preferredBooks.length ? String(preferredBooks[0]) : 'NoVigApp';
  const numericMaxAgeMs = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : null;
  const sharpBooks = Array.isArray(preferredBooks)
    ? preferredBooks.map((book) => String(book || '').trim()).filter(Boolean)
    : [];
  // Per-call memo for getLeagueRankingPreset. Keyed by league, with a
  // __marketKey stamp so a different market for the same league gets a
  // fresh preset rather than the previous one. Bounded by the unique-league
  // count in a single screen (typically <= 1).
  const presetCache = new Map();
  return (Array.isArray(rows) ? rows : [])
    .flatMap((row) => expandScreenRow(row, { preferredBook, requirePreferredBook }))
    .map((row) => {
      const rowMarketName = String(row?.market || getTennisMarketName(row) || row?.selection || '').toLowerCase();
      // getLeagueRankingPreset is pure (depends only on league+market) and
      // builds a fresh object every call. For a 20-row screen that's 20
      // redundant normalizeLeagueName + getSharpBookComparisonSet chains.
      // Memoise on (league, market) for the duration of this rankScreenRows
      // call so identical rows in the same batch share one preset object.
      const rowLeague = row?.league || row?.sport || row?.gameType || '';
      let leaguePreset = presetCache.get(rowLeague);
      if (!leaguePreset || leaguePreset.__marketKey !== rowMarketName) {
        leaguePreset = getLeagueRankingPreset(rowLeague, rowMarketName);
        leaguePreset.__marketKey = rowMarketName;
        presetCache.set(rowLeague, leaguePreset);
      }
      const marketPriority = getMarketPriorityScore(leaguePreset, rowMarketName);
      const marketHintMatch = marketPriority ? marketPriority.match : null;
      const marketHintScore = marketPriority ? marketPriority.weight : 0;
      const movementSummary = summarizeSharpMovement({
        lineHistory: row?.lineHistory,
        preferredBook,
        sharpBooks,
        options: {
          recentWindowHours,
          maxAbsOdds: 1500
        }
      });
      // Multi-window consensus score: fraction of time windows where all
      // configured sharp books agreed on direction. Surfaced alongside
      // movementLabel so the movement grade and risk score can require
      // sustained agreement (>= 0.66 = at least 4 of 6 windows).
      const multiWindowResult = computeMultiWindowScore(row, {
        nowMs: Date.now()
      });
      // Strict steam rule: 3+ sharp books, 5-minute window (industry standard for
      // genuine cross-book coordination rather than 2-book consensus drift).
      // Legacy (1h/2-book) is computed alongside for backwards-compat comparison
      // — exposed as steamMoveLegacy so the daily report can show what each rule
      // would have flagged.
      const nowMs = Date.now();
      const steamMoveResult = detectSteamMove(row, {
        nowMs,
        steamWindowMs: 5 * 60 * 1000,
        minBooks: 3
      });
      const steamMoveLegacyResult = detectSteamMove(row, {
        nowMs,
        steamWindowMs: 60 * 60 * 1000,
        minBooks: 2
      });
      const trail = extractHistoryTrail(row);
      const fallbackOpeningOdds = trail.length >= 2 ? trail[0] : null;
      const fallbackCurrentOdds =
        trail.length >= 2
          ? trail[trail.length - 1]
          : extractNumericTrailValue({ odds: row?.odds || row?.currentOdds || row?.price });
      const fallbackOpeningProb = americanOddsToImpliedProbability(fallbackOpeningOdds);
      const fallbackCurrentProb = americanOddsToImpliedProbability(fallbackCurrentOdds);
      const fallbackClvProxyPct =
        Number.isFinite(fallbackOpeningProb) && Number.isFinite(fallbackCurrentProb)
          ? (fallbackOpeningProb - fallbackCurrentProb) * 100
          : null;
      const openingOdds = movementSummary.lineHistoryUsable ? movementSummary.openingOdds : fallbackOpeningOdds;
      const currentOdds = movementSummary.lineHistoryUsable ? movementSummary.currentOdds : fallbackCurrentOdds;
      const clvProxyPct = movementSummary.lineHistoryUsable ? movementSummary.clvProxyPct : fallbackClvProxyPct;
      const rawConsensusEdge = row?.consensusEdge ?? row?.value ?? row?.ev ?? row?.edge;
      const consensusEdge = Number(rawConsensusEdge);
      const hasConsensus = Boolean(row?.hasConsensus) || Number.isFinite(consensusEdge);
      const book = String(row?.book || row?.sportsbook || '').trim();
      const preferredBookMatch = matchesPreferredBook(book, preferredBook);
      const hasLineMovement = Number.isFinite(clvProxyPct);
      const freshnessInfo = extractRowFreshnessInfo(row);
      const freshnessMs = freshnessInfo?.ms ?? null;
      const freshnessAgeMs = Number.isFinite(freshnessMs) ? Math.max(0, nowMs - freshnessMs) : null;
      const freshnessSource = freshnessInfo?.source || 'response_received';
      const freshnessFallbackUsed = !freshnessInfo;
      const isStale =
        Number.isFinite(numericMaxAgeMs) && Number.isFinite(freshnessMs) ? freshnessAgeMs > numericMaxAgeMs : false;
      const movementWeight = movementSummary.lineHistoryUsable
        ? (movementSummary.movementQualityScore || 0) *
          (movementSummary.movementMode === 'mixed_books_fallback' ? 0.75 : 1)
        : 1;
      const movementScore = hasLineMovement ? clvProxyPct * 1.5 * movementWeight : 0;
      const consensusScore = hasConsensus ? consensusEdge * 2 : 0;
      const sportScore = hasConsensus || hasLineMovement ? marketHintScore : 0;
      const freshnessPenalty = isStale ? -5 : 0;
      const score = consensusScore + movementScore + sportScore + freshnessPenalty;
      const gate = passesLeagueRankingGate({ score, hasConsensus, hasLineMovement, leaguePreset, marketHintMatch });
      const movementReason = movementSummary.lineHistoryUsable
        ? [
            movementSummary.movementMode === 'same_book' && movementSummary.movementSourceBook
              ? `same-book sharp movement from ${movementSummary.movementSourceBook}`
              : movementSummary.movementMode === 'mixed_books_fallback'
                ? 'movement available but low confidence, mixed-book fallback'
                : null,
            movementSummary.movementLabel === 'recent_supportive_only'
              ? 'recent supportive movement only, full-window move adverse'
              : movementSummary.movementLabel === 'supportive'
                ? `CLV proxy ${clvProxyPct.toFixed(2)}%`
                : movementSummary.movementLabel === 'adverse'
                  ? `adverse movement, CLV proxy ${clvProxyPct.toFixed(2)}%`
                  : `movement ${movementSummary.movementLabel}, CLV proxy ${clvProxyPct.toFixed(2)}%`,
            movementSummary.movementQuality ? `quality ${movementSummary.movementQuality}` : null
          ]
            .filter(Boolean)
            .join(', ')
        : Number.isFinite(clvProxyPct)
          ? `legacy CLV proxy ${clvProxyPct.toFixed(2)}%`
          : 'no usable sharp movement';
      const rankingReason = isStale
        ? `stale data older than ${Math.round(numericMaxAgeMs / 1000)}s, ${leaguePreset.displayName} preset, consensus edge${row?.consensusBookCount ? ` across ${row.consensusBookCount} comp books` : ''}${hasLineMovement ? `, ${movementReason}` : ''}${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
        : hasConsensus
          ? `${leaguePreset.displayName} preset, ranked by consensus edge${row?.consensusBookCount ? ` across ${row.consensusBookCount} comp books` : ''}${hasLineMovement ? `, ${movementReason}` : ''}${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
          : hasLineMovement
            ? `${leaguePreset.displayName} preset, ranked by line movement only, ${movementReason}${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
            : `${leaguePreset.displayName} preset, unranked: no consensus comparison or line movement available${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`;
      return {
        row,
        score,
        // Strict steam (5-min, 3+ sharp books) drives downstream scoring.
        steamMove: steamMoveResult.isSteam,
        steamBooks: steamMoveResult.steamBooks,
        steamDirection: steamMoveResult.direction,
        steamBookCount: steamMoveResult.dominantBookCount,
        // Legacy steam (1h, 2+ sharp books) kept for comparison; does NOT affect scoring.
        steamMoveLegacy: steamMoveLegacyResult.isSteam,
        steamBooksLegacy: steamMoveLegacyResult.steamBooks,
        steamDirectionLegacy: steamMoveLegacyResult.direction,
        steamBookCountLegacy: steamMoveLegacyResult.dominantBookCount,
        // Multi-window consensus score: 0.0-1.0 (consensus windows / total windows).
        // Used by movement grade and risk score to require sustained agreement
        // across the 1h/2h/6h/12h/24h/48h windows.
        multiWindowScore: multiWindowResult.score,
        consensusWindowCount: multiWindowResult.consensusWindowCount,
        totalConsensusWindows: multiWindowResult.totalWindows,
        consensusWindows: multiWindowResult.consensusWindows,
        multiWindowInsufficientData: multiWindowResult.hasInsufficientData,
        freshnessMs,
        freshnessAgeMs,
        freshnessSource,
        freshnessFallbackUsed,
        isStale,
        gatePassed: gate.passed,
        gateReason: gate.reason,
        leaguePreset: leaguePreset.displayName,
        marketHintMatch,
        consensusEdge: hasConsensus ? consensusEdge : null,
        clvProxyPct,
        openingOdds,
        currentOdds,
        market: rowMarketName || getTennisMarketName(row),
        book,
        preferredBookMatch,
        hasConsensus,
        hasLineMovement,
        isActionable: gate.passed,
        warning: gate.passed ? null : 'Insufficient comparison data',
        consensusBookCount: Number(row?.consensusBookCount || 0),
        marketBookCount: Number(row?.marketBookCount || 0),
        marketBooks: Array.isArray(row?.marketBooks) ? row.marketBooks : [],
        supportBookCount: Number(row?.supportBookCount || 0),
        supportBooks: Array.isArray(row?.supportBooks) ? row.supportBooks : [],
        targetBookOdds: row?.targetBookOdds ?? null,
        bestAvailableOdds: row?.bestAvailableOdds ?? null,
        executionQuality: row?.executionQuality ?? 'unknown',
        movementSummary,
        scoreBreakdown: {
          consensusScore: Number(consensusScore.toFixed(3)),
          movementScore: Number(movementScore.toFixed(3)),
          sportScore: Number(sportScore.toFixed(3)),
          freshnessPenalty: Number(freshnessPenalty.toFixed(3)),
          total: Number(score.toFixed(3))
        },
        rankingReason
      };
    })
    .filter((item) => {
      if (!includeAll && !item.gatePassed) return false;
      // playableOnly (added 2026-06-15): user wants plays that are
      // *executable* on the chosen book, not plays where the chosen book
      // beats the comp consensus. Drop "bad" execution (Fliff is wildly
      // off-market) but keep "playable" and "best" rows even when the
      // consensus edge is negative or zero.
      if (playableOnly && item.executionQuality === 'bad') return false;
      return true;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.consensusEdge ?? -999) - Number(a.consensusEdge ?? -999) ||
        Number(b.clvProxyPct ?? -999) - Number(a.clvProxyPct ?? -999)
    )
    .slice(0, limit)
    .map((item) => {
      const rankingProvenance = {
        leaguePreset: item.leaguePreset,
        focusBook: preferredBook,
        requestedHistorySportsbooks: item.row.historySportsbooksRequested ?? [],
        sourceBook: item.book,
        sourceMarket: item.market,
        marketHintMatch: item.marketHintMatch,
        lineHistorySource: item.row.lineHistorySource ?? null,
        historyMatchedBy: item.row.historyMatchedBy ?? null,
        historyMatchKey: item.row.historyMatchKey ?? null,
        normalizedSelectionId: item.row.normalizedSelectionId ?? null,
        historyGameId: item.row.historyGameId ?? null,
        rankingReason: item.rankingReason
      };
      const debugPayload = {
        movementSourceBook: item.movementSummary.movementSourceBook,
        movementMode: item.movementSummary.movementMode,
        movementLabel: item.movementSummary.movementLabel,
        movementPointCount: item.movementSummary.movementPointCount,
        filteredHistoryPointCount: item.movementSummary.filteredHistoryPointCount,
        droppedHistoryPointCount: item.movementSummary.droppedHistoryPointCount,
        droppedHistoryReasons: item.movementSummary.droppedHistoryReasons,
        movementQuality: item.movementSummary.movementQuality,
        movementQualityScore: item.movementSummary.movementQualityScore,
        lineHistoryUsable: item.movementSummary.lineHistoryUsable,
        openingOdds: item.movementSummary.openingOdds,
        currentOdds: item.movementSummary.currentOdds,
        openToCurrentClvPct: item.movementSummary.openToCurrentClvPct,
        recentClvPct: item.movementSummary.recentClvPct,
        recentWindowHours: item.movementSummary.recentWindowHours,
        recentSharpMoveDirection: item.movementSummary.recentSharpMoveDirection,
        fullWindowSharpMoveDirection: item.movementSummary.fullWindowSharpMoveDirection
      };
      return {
        ...item.row,
        consensusEdge: item.consensusEdge,
        steamMove: item.steamMove,
        steamBooks: item.steamBooks,
        steamDirection: item.steamDirection,
        steamBookCount: item.steamBookCount,
        steamMoveLegacy: item.steamMoveLegacy,
        steamBooksLegacy: item.steamBooksLegacy,
        steamDirectionLegacy: item.steamDirectionLegacy,
        steamBookCountLegacy: item.steamBookCountLegacy,
        multiWindowScore: item.multiWindowScore,
        consensusWindowCount: item.consensusWindowCount,
        totalConsensusWindows: item.totalConsensusWindows,
        consensusWindows: item.consensusWindows,
        multiWindowInsufficientData: item.multiWindowInsufficientData,
        clvProxyPct: item.clvProxyPct,
        openingOdds: item.openingOdds,
        currentOdds: item.currentOdds,
        freshnessMs: item.freshnessMs,
        freshnessAgeMs: item.freshnessAgeMs,
        freshnessSource: item.freshnessSource,
        freshnessFallbackUsed: item.freshnessFallbackUsed,
        stale: item.isStale,
        screenMarket: item.market,
        leaguePreset: item.leaguePreset,
        marketHintMatch: item.marketHintMatch,
        screenScore: Number(item.score.toFixed(3)),
        preferredBookMatch: item.preferredBookMatch,
        gatePassed: item.gatePassed,
        gateReason: item.gateReason,
        hasConsensus: item.hasConsensus,
        hasLineMovement: item.hasLineMovement,
        isActionable: item.gatePassed,
        warning: item.gatePassed ? null : 'Insufficient comparison data',
        consensusBookCount: item.consensusBookCount,
        marketBookCount: item.marketBookCount,
        marketBooks: item.marketBooks,
        supportBookCount: item.supportBookCount,
        supportBooks: item.supportBooks,
        targetBookOdds: item.targetBookOdds,
        bestAvailableOdds: item.bestAvailableOdds,
        executionQuality: item.executionQuality,
        movementGrade: gradeMovementQuality(item),
        riskScore: calculateRiskScore(item),
        kaiCall: getKaiCall(item),
        confidenceTier: getConfidenceTierStable(item),
        tierTrajectory: getTierTrajectory(item),
        rationale: buildRationale(item),
        movementSourceBook: item.movementSummary.movementSourceBook,
        movementMode: item.movementSummary.movementMode,
        movementLabel: item.movementSummary.movementLabel,
        movementPointCount: item.movementSummary.movementPointCount,
        filteredHistoryPointCount: item.movementSummary.filteredHistoryPointCount,
        droppedHistoryPointCount: item.movementSummary.droppedHistoryPointCount,
        movementQuality: item.movementSummary.movementQuality,
        movementQualityScore: item.movementSummary.movementQualityScore,
        lineHistoryUsable: item.movementSummary.lineHistoryUsable,
        recentClvPct: item.movementSummary.recentClvPct,
        recentWindowHours: item.movementSummary.recentWindowHours,
        recentSharpMoveDirection: item.movementSummary.recentSharpMoveDirection,
        fullWindowSharpMoveDirection: item.movementSummary.fullWindowSharpMoveDirection,
        openToCurrentClvPct: item.movementSummary.openToCurrentClvPct,
        historySportsbooksRequested: item.row.historySportsbooksRequested ?? [],
        rankingProvenance,
        scoreBreakdown: item.scoreBreakdown,
        rankingReason: item.rankingReason,
        historyMatchKey: item.row.historyMatchKey ?? item.historyMatchKey,
        ...(debug
          ? {
              droppedHistoryReasons: item.movementSummary.droppedHistoryReasons,
              filteredLineHistory: item.movementSummary.filteredLineHistory,
              droppedHistoryPoints: item.movementSummary.droppedHistoryPoints,
              movementDebug: debugPayload
            }
          : {})
      };
    });
}

/**
 * Rank screen rows for a specific league, applying league-specific ranking presets.
 * @param {Array<Object>} rows - Array of row data.
 * @param {Object} [options={}] - Options including league, market, limit, etc.
 * @param {string} [options.league='NBA'] - League name.
 * @param {string} [options.market] - Market name.
 * @param {number} [options.limit=12] - Max rows to return.
 * @param {boolean} [options.includeAll=false] - Include rows that don't pass gate.
 * @param {number|null} [options.maxAgeMs=null] - Staleness threshold.
 * @param {number[]|string[]} [options.books=[]] - Preferred books.
 * @param {number} [options.recentWindowHours=6] - Recent movement window.
 * @param {boolean} [options.debug=true] - Include debug payload.
 * @returns {Array<Object>} Ranked rows with league preset metadata.
 */
function rankLeagueScreenRows(
  rows,
  {
    league = 'NBA',
    market,
    limit = 12,
    includeAll = false,
    maxAgeMs = null,
    books = [],
    recentWindowHours = 6,
    debug = true,
    requirePreferredBook = false,
    playableOnly = false
  } = {}
) {
  const preset = getLeagueRankingPreset(league, market);
  const filteredRows = filterRowsByLeague(rows, preset.league);
  return rankScreenRows(filteredRows, {
    limit,
    preferredBooks: Array.isArray(books) && books.length ? books : preset.preferredBooks,
    includeAll,
    maxAgeMs,
    recentWindowHours,
    debug: debug === undefined ? true : debug,
    requirePreferredBook,
    playableOnly
  }).map((row) => ({
    ...row,
    leaguePreset: preset.displayName,
    rankingPreset: preset.displayName,
    rankingMarkets: (preset.marketPriorities || []).map((item) => item.match)
  }));
}

module.exports = {
  average,
  expandScreenRow,
  filterRowsByLeague,
  getLeagueRankingPreset,
  getMarketPriorityScore,
  getResolvedScreenSelection,
  getScreenSelection,
  getTennisMarketName,
  passesLeagueRankingGate,
  rankLeagueScreenRows,
  rankScreenRows,
  resolveExtractedScreenSide
};
