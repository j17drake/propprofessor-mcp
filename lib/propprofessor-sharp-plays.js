'use strict';

function normalizeBook(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact === 'novig' || compact === 'novigapp' || compact === 'novigapps') return 'NoVigApp';
  if (compact === 'fliff') return 'Fliff';
  if (compact === 'rebet') return 'Rebet';
  return raw;
}

function sameBook(left, right) {
  return normalizeBook(left).toLowerCase() === normalizeBook(right).toLowerCase();
}

function uniqueBooks(books) {
  return Array.from(new Set((Array.isArray(books) ? books : []).map(normalizeBook).filter(Boolean)));
}

function parseFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

function normalizeDateKey(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function utcDateKey(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseRowStartMs(row = {}) {
  if (!row || typeof row !== 'object') return null;
  const candidate = row.start ?? row.startTime ?? row.startsAt ?? row.eventStart ?? row.eventStartTime ?? row.startMs ?? row.start_ms;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string' && /^\d+$/.test(candidate.trim())) {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterUfcRowsForCard(rows = [], options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const upcomingOnly = options.upcomingOnly !== undefined ? Boolean(options.upcomingOnly) : true;
  const cardWindow = String(options.cardWindow || 'all').trim().toLowerCase();
  const eventDate = normalizeDateKey(options.eventDate);
  const maxHoursAway = parseFiniteNumber(options.maxHoursAway);
  const todayKey = utcDateKey(nowMs);
  const nextKey = utcDateKey(nowMs + 24 * 60 * 60 * 1000);
  const strictDateWindow = Boolean(eventDate || cardWindow === 'today' || cardWindow === 'next');

  return sourceRows.filter((row) => {
    if (!row || typeof row !== 'object') return false;

    const startMs = parseRowStartMs(row);
    const startDateKey = startMs === null ? null : utcDateKey(startMs);
    let dateMatches = true;

    if (strictDateWindow) {
      if (startMs === null || startDateKey === null) return false;
      if (eventDate) dateMatches = startDateKey === eventDate;
      else if (cardWindow === 'today') dateMatches = startDateKey === todayKey;
      else if (cardWindow === 'next') dateMatches = startDateKey === nextKey;
      if (!dateMatches) return false;
    }

    if (startMs !== null && upcomingOnly && startMs < nowMs) return false;

    if (startMs !== null && maxHoursAway !== null) {
      const deltaHours = (startMs - nowMs) / (60 * 60 * 1000);
      if (upcomingOnly) {
        if (deltaHours < 0 || deltaHours > maxHoursAway) return false;
      } else if (Math.abs(deltaHours) > maxHoursAway) {
        return false;
      }
    }

    return true;
  });
}

function resolveTargetBooks(args = {}) {
  const fallback = args.book || args.targetBook || args.sportsbook || (Array.isArray(args.books) && args.books[0]) ? [args.book || args.targetBook || args.sportsbook || args.books[0]] : ['NoVigApp'];
  const raw = Array.isArray(args.targetBooks)
    ? args.targetBooks
    : Array.isArray(args.books)
      ? args.books
      : args.targetBooksCsv || args.target_books_csv || args.targetBookCsv || args.target_book_csv
        ? normalizeList(args.targetBooksCsv || args.target_books_csv || args.targetBookCsv || args.target_book_csv, fallback)
        : fallback;
  const books = uniqueBooks(normalizeList(raw, fallback).map(normalizeBook));
  return books.length ? books : ['NoVigApp'];
}

function resolveTargetBook(args = {}) {
  return resolveTargetBooks(args)[0] || 'NoVigApp';
}

function resolveSharpPlayLeagues(args = {}) {
  return uniqueBooks(normalizeList(args.leagues, args.league ? [args.league] : ['NBA', 'MLB', 'NHL', 'Tennis', 'WNBA', 'UFC']));
}

function resolveSharpPlayMarkets(args = {}) {
  return uniqueBooks(normalizeList(args.markets, args.market ? [args.market] : ['Moneyline']));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSupportedMovementLabel(row, { allowRecentOnly = false } = {}) {
  if (row?.movementLabel === 'supportive') return true;
  return Boolean(allowRecentOnly && row?.movementLabel === 'recent_supportive_only');
}

function classifySharpPlay(row = {}, options = {}) {
  const targetBook = resolveTargetBook(options);
  const strict = options.strict !== undefined ? Boolean(options.strict) : true;
  const allowRecentOnly = Boolean(options.allowRecentOnly);
  const minConsensusBookCount = Number.isFinite(Number(options.minConsensusBookCount))
    ? Number(options.minConsensusBookCount)
    : 2;
  const minMarketBookCount = Number.isFinite(Number(options.minMarketBookCount))
    ? Number(options.minMarketBookCount)
    : 2;
  const minSupportBookCount = Number.isFinite(Number(options.minSupportBookCount))
    ? Number(options.minSupportBookCount)
    : 1;
  const requireIndependentSharpMovement = options.requireIndependentSharpMovement !== undefined
    ? Boolean(options.requireIndependentSharpMovement)
    : true;
  const requirePlayablePrice = options.requirePlayablePrice !== undefined
    ? Boolean(options.requirePlayablePrice)
    : true;
  const requireBestPrice = Boolean(options.requireBestPrice);
  const minOdds = parseFiniteNumber(options.minOdds);
  const maxOdds = parseFiniteNumber(options.maxOdds);
  const odds = parseFiniteNumber(row.odds ?? row.currentOdds ?? row.price);
  const consensusBookCount = Number(row.consensusBookCount || 0);
  const consensusEdge = parseFiniteNumber(row.consensusEdge ?? row.value ?? row.ev ?? row.edge);
  const hasConsensusEdge = Number.isFinite(consensusEdge) && consensusEdge > 0;
  const movementSourceBook = normalizeBook(row.movementSourceBook);
  const movementLabelSupported = isSupportedMovementLabel(row, { allowRecentOnly });
  const sourceIsTargetBook = movementSourceBook ? sameBook(movementSourceBook, targetBook) : false;
  const independentBookOk = requireIndependentSharpMovement ? !sourceIsTargetBook : true;
  const movementIsSharpSourced = Boolean(
    row.lineHistoryUsable &&
      row.movementMode === 'same_book' &&
      movementSourceBook &&
      independentBookOk &&
      movementLabelSupported
  );
  const priceInBand =
    Number.isFinite(odds) &&
    (minOdds === null || odds >= minOdds) &&
    (maxOdds === null || odds <= maxOdds);
  const isPropMarket = /player|pitcher/i.test(String(row.market || row.screenMarket || row.scanMarket || ''));
  const alternativeBookCountsOk =
    Number(row.marketBookCount || 0) >= minMarketBookCount &&
    Number(row.supportBookCount || 0) >= minSupportBookCount;
  const marketOk = isPropMarket
    ? Number(row.marketBookCount || 0) >= minMarketBookCount
    : consensusBookCount >= minConsensusBookCount || alternativeBookCountsOk;
  const supportOk = isPropMarket
    ? Number(row.supportBookCount || 0) >= minSupportBookCount
    : consensusBookCount >= minConsensusBookCount || alternativeBookCountsOk;
  const effectiveExecutionQuality = String(row.executionQuality || '');
  const executionOk = requireBestPrice
    ? effectiveExecutionQuality === 'best'
    : requirePlayablePrice
      ? ['best', 'playable'].includes(effectiveExecutionQuality)
      : effectiveExecutionQuality !== 'bad';
  const consensusOk = consensusBookCount >= minConsensusBookCount;
  const stale =
    Boolean(row.stale || row.isStale) &&
    Number.isFinite(row.freshnessAgeMs) &&
    Number.isFinite(Number(options.maxAgeMs));

  // Consensus-edge-only fallback for books like NoVigApp that have unique
  // lines (no vig removed) so they never match other books' lines for
  // consensus count, but the screen API still computes a consensus edge
  // against the market. Uses the consensus edge as a proxy for market
  // agreement when line history and consensus book count are unavailable.
  const consensusEdgeOnlyOk =
    hasConsensusEdge &&
    !movementIsSharpSourced &&
    priceInBand &&
    !stale &&
    consensusBookCount < minConsensusBookCount;

  // Consensus-only fallback for execution books that can't validate movement.
  // Covers two scenarios:
  // 1) No line history at all (Fliff posted late, no comp books to measure)
  // 2) Movement exists but only from the target book itself (Fliff is the
  //    only book that moved, so we can't call it independent sharp movement).
  // In both cases, the movement label must still be supportive, and we require
  // elevated consensus (2x minimum) to compensate for missing independent confirmation.
  const movementLabelOk = movementLabelSupported;
  const movementUnverifiable = !movementIsSharpSourced && (sourceIsTargetBook || !movementSourceBook);
  const consensusOnlyOk =
    movementLabelOk &&
    movementUnverifiable &&
    consensusBookCount >= minConsensusBookCount * 2 &&
    priceInBand &&
    !stale;

  // CLV-only fallback for books like NoVigApp whose vig-removed lines never
  // match other books' exact prices (so consensusBookCount stays 0), but the
  // screen API still computes a meaningful CLV from the odds history hydration.
  // This is weaker than cross-book consensus, so it only produces Lean (never
  // Bet candidate) and requires both supportive label and positive CLV.
  const clvValue = parseFiniteNumber(row.clvProxyPct);
  const clvOnlyOk =
    movementLabelOk &&
    movementUnverifiable &&
    !consensusOnlyOk &&
    !consensusEdgeOnlyOk &&
    Number.isFinite(clvValue) &&
    clvValue > 0 &&
    priceInBand &&
    !stale;

  // Consensus-validated: enough books agree on a positive edge and movement is
  // supportive, but the only movement source is the target book itself
  // (NoVigApp). The consensus edge from the screen API is real — it's computed
  // from all books' implied probabilities. This is weaker than full sharp
  // validation (independent movement confirmation) but stronger than CLV-only.
  // Produces Bet candidate in both strict and non-strict mode.
  const consensusValidated =
    consensusOk &&
    hasConsensusEdge &&
    movementLabelSupported &&
    !movementIsSharpSourced &&
    priceInBand &&
    !stale;

  const passReasons = [];

  if (!Number.isFinite(odds)) passReasons.push('computed_field_missing_for_side');
  if (!priceInBand) passReasons.push('outside_playable_odds_band');
  if (stale) passReasons.push('stale_row');
  if (!consensusOk && !isPropMarket && !alternativeBookCountsOk && !consensusEdgeOnlyOk && !clvOnlyOk) passReasons.push(`consensus_book_count_below_${minConsensusBookCount}`);
  if (!consensusOk && !isPropMarket && alternativeBookCountsOk && !consensusEdgeOnlyOk) passReasons.push('consensus_metric_only_failure');
  if (isPropMarket && !marketOk) passReasons.push('insufficient_market_availability');
  if (isPropMarket && !supportOk) passReasons.push('insufficient_same_side_support');
  if (isPropMarket && !executionOk) passReasons.push('playable_price_failed');
  if (!consensusOk && isPropMarket && marketOk && supportOk && executionOk) {
    // pass silently — the new fields override consensusBookCount for props
  } else if (!consensusOk && isPropMarket && !consensusEdgeOnlyOk) {
    passReasons.push(`consensus_book_count_below_${minConsensusBookCount}`);
  }
  if (!consensusEdgeOnlyOk && !clvOnlyOk) {
    if (!row.lineHistoryUsable) passReasons.push('no_usable_line_history');
    if (!movementLabelSupported) passReasons.push(`movement_not_supportive_${row.movementLabel || 'unknown'}`);
    if (requireIndependentSharpMovement && sourceIsTargetBook) passReasons.push('movement_source_is_target_book');
    if (row.movementMode && row.movementMode !== 'same_book') passReasons.push(`movement_mode_${row.movementMode}`);
    if (!movementSourceBook) passReasons.push('missing_movement_source_book');
  }

  const movementScore = movementIsSharpSourced ? 40 * clamp(Number(row.movementQualityScore || 0.75), 0.35, 1) : 0;
  const consensusScore = clamp(consensusBookCount / Math.max(minConsensusBookCount, 1), 0, 2) * 12.5;
  const edge = parseFiniteNumber(row.consensusEdge);
  const edgeScore = edge === null ? 0 : clamp(edge, -5, 5) * 2 + 10;
  const freshnessScore = stale ? 0 : 10;
  const marketScore = row.gatePassed || row.isActionable ? 5 : 0;
  const steamBonus = row.steamMove ? 15 : 0;
  const sharpPlayScore = Number((movementScore + consensusScore + edgeScore + freshnessScore + marketScore + steamBonus).toFixed(3));

  const propClassifyOk = movementIsSharpSourced && marketOk && supportOk && executionOk && priceInBand && !stale;
  const mainClassifyOk = movementIsSharpSourced && consensusOk && priceInBand && !stale;
  let verdict = 'Pass';
  if (isPropMarket && propClassifyOk) {
    verdict = 'Bet candidate';
  } else if (!isPropMarket && mainClassifyOk) {
    verdict = 'Bet candidate';
  } else if (!isPropMarket && consensusOnlyOk) {
    verdict = 'Bet candidate';
  } else if (!isPropMarket && consensusEdgeOnlyOk) {
    verdict = 'Bet candidate';
  } else if (consensusValidated) {
    verdict = 'Bet candidate';
  } else if (!strict && movementIsSharpSourced && priceInBand && !stale) {
    verdict = 'Lean';
  } else if (!strict && consensusOnlyOk) {
    verdict = 'Lean';
  } else if (!strict && consensusEdgeOnlyOk) {
    verdict = 'Lean';
  } else if (!strict && clvOnlyOk) {
    verdict = 'Lean';
  }

  return {
    verdict,
    passReasons,
    sharpPlayScore,
    support: {
      targetBook,
      odds,
      consensusBookCount,
      minConsensusBookCount,
      movementSourceBook: movementSourceBook || null,
      movementLabel: row.movementLabel || null,
      movementMode: row.movementMode || null,
      movementIsSharpSourced,
      sourceIsTargetBook,
      priceInBand,
      stale
    }
  };
}

function shouldIncludeSharpPlayRow(row = {}, { strict = true, includePasses = false } = {}) {
  if (includePasses) return true;
  if (strict) return row.verdict === 'Bet candidate';
  return row.verdict === 'Bet candidate' || row.verdict === 'Lean';
}

function compareSharpPlayRows(left = {}, right = {}) {
  return (
    Number(right.sharpPlayScore || 0) - Number(left.sharpPlayScore || 0) ||
    Number(right.consensusBookCount || 0) - Number(left.consensusBookCount || 0) ||
    Number(right.screenScore || right.tennisScore || 0) - Number(left.screenScore || left.tennisScore || 0)
  );
}

function dedupeSharpPlayRows(rows = []) {
  const seenPlays = new Set();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const gameKey = String(row.gameId || row.game_id || row.game || row.matchup || '').trim();
    const executionBook = normalizeBook(row.executionBook || row.targetBook || row.book || row.sharpPlaySupport?.targetBook || '').trim();
    const marketKey = String(row.scanMarket || row.screenMarket || row.market || row.playType || '').trim();
    const pickKey = String(row.pick || row.selection || row.participant || row.selectionId || row.selection_id || '').trim();
    const lineKey = String(row.line ?? row.points ?? row.handicap ?? row.total ?? '').trim();
    const dedupeKey = [executionBook, gameKey, marketKey, pickKey, lineKey].join('|');
    if (!gameKey || !executionBook || !pickKey) return true;
    if (seenPlays.has(dedupeKey)) return false;
    seenPlays.add(dedupeKey);
    return true;
  });
}

function toNearMissPreview(row = {}) {
  return {
    pick: row.pick || row.selection || row.participant || null,
    odds: parseFiniteNumber(row.odds ?? row.currentOdds ?? row.price),
    movementSourceBook: normalizeBook(row.movementSourceBook) || null,
    movementLabel: row.movementLabel || null,
    steamMove: Boolean(row.steamMove),
    consensusEdge: Number.isFinite(Number(row.consensusEdge)) ? Number(row.consensusEdge) : null,
    consensusBookCount: Number.isFinite(Number(row.consensusBookCount)) ? Number(row.consensusBookCount) : 0,
    marketBookCount: Number.isFinite(Number(row.marketBookCount)) ? Number(row.marketBookCount) : 0,
    supportBookCount: Number.isFinite(Number(row.supportBookCount)) ? Number(row.supportBookCount) : 0,
    executionQuality: row.executionQuality || 'unknown',
    lineHistoryUsable: Boolean(row.lineHistoryUsable),
    passReasons: Array.isArray(row.passReasons) ? [...row.passReasons] : [],
    sharpPlayScore: Number.isFinite(Number(row.sharpPlayScore)) ? Number(row.sharpPlayScore) : 0
  };
}

function summarizeSharpPlayRows(rows = [], options = {}) {
  const strict = options.strict !== undefined ? Boolean(options.strict) : true;
  const includePasses = Boolean(options.includePasses);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 10;

  const classifiedEntries = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => {
      const classification = classifySharpPlay(row, { ...options, strict });
      return {
        index,
        row: {
          ...row,
          verdict: classification.verdict,
          passReasons: classification.passReasons,
          sharpPlayScore: classification.sharpPlayScore,
          sharpPlaySupport: classification.support
        }
      };
    });

  const verdictCounts = {};
  const passReasonCounts = {};
  for (const entry of classifiedEntries) {
    const verdict = String(entry.row.verdict || 'Pass');
    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1;
    for (const reason of Array.isArray(entry.row.passReasons) ? entry.row.passReasons : []) {
      passReasonCounts[reason] = (passReasonCounts[reason] || 0) + 1;
    }
  }

  const filteredRows = dedupeSharpPlayRows(
    classifiedEntries
      .map((entry) => entry.row)
      .filter((row) => shouldIncludeSharpPlayRow(row, { strict, includePasses }))
      .sort(compareSharpPlayRows)
  ).slice(0, limit);

  const topNearMisses = classifiedEntries
    .filter((entry) => entry.row.verdict === 'Pass')
    .sort((left, right) => {
      const scoreDelta = Number(right.row.sharpPlayScore || 0) - Number(left.row.sharpPlayScore || 0);
      if (scoreDelta) return scoreDelta;
      const consensusDelta = Number(right.row.consensusBookCount || 0) - Number(left.row.consensusBookCount || 0);
      if (consensusDelta) return consensusDelta;
      const leftPick = String(left.row.pick || left.row.selection || left.row.participant || '').trim().toLowerCase();
      const rightPick = String(right.row.pick || right.row.selection || right.row.participant || '').trim().toLowerCase();
      if (leftPick !== rightPick) return leftPick.localeCompare(rightPick);
      return left.index - right.index;
    })
    .slice(0, 3)
    .map((entry) => toNearMissPreview(entry.row));

  return {
    classifiedRows: classifiedEntries.map((entry) => entry.row),
    filteredRows,
    classificationSummary: {
      totalRowsClassified: classifiedEntries.length,
      verdictCounts,
      passReasonCounts
    },
    topNearMisses
  };
}

function buildSharpPlaysFromRankedRows(rows = [], options = {}) {
  return summarizeSharpPlayRows(rows, options).filteredRows;
}

function getUfcShortlistVerdict(row = {}, options = {}) {
  const classification = classifySharpPlay(row, { ...options, strict: true });
  if (classification.verdict === 'Bet candidate') return 'Bet';

  const support = classification.support || {};
  const movementLabel = String(row.movementLabel || '').trim().toLowerCase();
  const consensusOk = Number(row.consensusBookCount || 0) >= Number(support.minConsensusBookCount || 2);
  const rankedEnough = Boolean(row.gatePassed || row.isActionable || Number(row.screenScore || row.tennisScore || 0) > 0);
  const leanMovement = ['supportive', 'recent_supportive_only', 'insufficient_history', 'mixed'].includes(movementLabel);

  if (!support.stale && support.priceInBand && rankedEnough && consensusOk && leanMovement && !support.sourceIsTargetBook) {
    return 'Lean';
  }
  return 'Pass';
}

function getUfcShortlistScore(row = {}) {
  const screenScore = Number(row.screenScore || row.tennisScore || 0);
  const consensusCount = Number(row.consensusBookCount || 0);
  const consensusEdge = parseFiniteNumber(row.consensusEdge) || 0;
  const qualityBonus = row.movementLabel === 'supportive'
    ? 3
    : row.movementLabel === 'recent_supportive_only'
      ? 2
      : row.movementLabel === 'insufficient_history'
        ? 1.5
        : row.movementLabel === 'mixed'
          ? 1
          : row.movementLabel === 'adverse'
            ? -2
            : 0;
  const stalePenalty = row.stale || row.isStale ? -5 : 0;
  return Number((screenScore + consensusCount * 0.75 + consensusEdge * 2 + qualityBonus + stalePenalty).toFixed(3));
}

function buildUfcShortlist(rows = [], options = {}) {
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 10;
  const cardWindow = String(options.cardWindow || 'all').trim().toLowerCase();
  const eventDate = normalizeDateKey(options.eventDate);
  const upcomingOnly = options.upcomingOnly !== undefined ? Boolean(options.upcomingOnly) : true;
  const maxHoursAway = parseFiniteNumber(options.maxHoursAway);
  const filteredRows = filterUfcRowsForCard(rows, {
    ...options,
    cardWindow,
    eventDate,
    upcomingOnly,
    maxHoursAway
  });
  const shortlisted = filteredRows
    .filter((row) => row && typeof row === 'object')
    .filter((row) => String(row.scanLeague || row.league || '').trim().toUpperCase() === 'UFC')
    .map((row) => {
      const classification = classifySharpPlay(row, { ...options, strict: true });
      const shortlistVerdict = getUfcShortlistVerdict(row, options);
      return {
        ...row,
        verdict: row.verdict || classification.verdict,
        passReasons: Array.isArray(row.passReasons) ? row.passReasons : classification.passReasons,
        sharpPlayScore: Number.isFinite(Number(row.sharpPlayScore)) ? Number(row.sharpPlayScore) : classification.sharpPlayScore,
        sharpPlaySupport: row.sharpPlaySupport || classification.support,
        shortlistVerdict,
        shortlistScore: getUfcShortlistScore(row),
        shortlistCardWindow: eventDate ? 'eventDate' : cardWindow,
        shortlistEventDate: eventDate,
        shortlistUpcomingOnly: upcomingOnly,
        shortlistMaxHoursAway: maxHoursAway,
        shortlistStartMs: parseRowStartMs(row)
      };
    })
    .sort(
      (left, right) =>
        Number(right.shortlistScore || 0) - Number(left.shortlistScore || 0) ||
        Number(right.screenScore || right.tennisScore || 0) - Number(left.screenScore || left.tennisScore || 0)
    )
    .slice(0, Math.max(limit * 2, limit));

  const bestBets = shortlisted.filter((row) => row.shortlistVerdict === 'Bet').slice(0, limit);
  const bestLooks = shortlisted.filter((row) => row.shortlistVerdict === 'Lean').slice(0, limit);
  const bestPasses = shortlisted.filter((row) => row.shortlistVerdict === 'Pass').slice(0, Math.min(limit, 5));
  const summaryText = `Best UFC looks: ${bestBets.length} official bet${bestBets.length === 1 ? '' : 's'}, ${bestLooks.length} lean${bestLooks.length === 1 ? '' : 's'}, ${bestPasses.length} pass${bestPasses.length === 1 ? '' : 'es'}.`;

  return {
    league: 'UFC',
    officialCount: bestBets.length,
    leanCount: bestLooks.length,
    passCount: bestPasses.length,
    bestBets,
    bestLooks,
    bestPasses,
    shortlistMeta: {
      totalCount: Array.isArray(rows) ? rows.length : 0,
      filteredCount: shortlisted.length,
      cardWindow: eventDate ? 'eventDate' : cardWindow,
      eventDate,
      upcomingOnly,
      maxHoursAway
    },
    summaryText
  };
}

module.exports = {
  buildSharpPlaysFromRankedRows,
  buildUfcShortlist,
  classifySharpPlay,
  filterUfcRowsForCard,
  normalizeList,
  parseRowStartMs,
  resolveSharpPlayLeagues,
  resolveSharpPlayMarkets,
  resolveTargetBook,
  resolveTargetBooks,
  summarizeSharpPlayRows,
  uniqueBooks
};
