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

function resolveTargetBooks(args = {}) {
  const fallback = args.book || args.targetBook || args.sportsbook ? [args.book || args.targetBook || args.sportsbook] : ['NoVigApp'];
  const raw = Array.isArray(args.targetBooks)
    ? args.targetBooks
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
  return uniqueBooks(normalizeList(args.leagues, args.league ? [args.league] : ['NBA', 'MLB', 'NHL', 'Tennis', 'WNBA']));
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
  const minOdds = parseFiniteNumber(options.minOdds);
  const maxOdds = parseFiniteNumber(options.maxOdds);
  const odds = parseFiniteNumber(row.odds ?? row.currentOdds ?? row.price);
  const consensusBookCount = Number(row.consensusBookCount || 0);
  const movementSourceBook = normalizeBook(row.movementSourceBook);
  const movementLabelSupported = isSupportedMovementLabel(row, { allowRecentOnly });
  const sourceIsTargetBook = movementSourceBook ? sameBook(movementSourceBook, targetBook) : false;
  const movementIsSharpSourced = Boolean(
    row.lineHistoryUsable &&
      row.movementMode === 'same_book' &&
      movementSourceBook &&
      !sourceIsTargetBook &&
      movementLabelSupported
  );
  const priceInBand =
    Number.isFinite(odds) &&
    (minOdds === null || odds >= minOdds) &&
    (maxOdds === null || odds <= maxOdds);
  const consensusOk = consensusBookCount >= minConsensusBookCount;
  const stale =
    Boolean(row.stale || row.isStale) &&
    Number.isFinite(row.freshnessAgeMs) &&
    Number.isFinite(Number(options.maxAgeMs));
  const passReasons = [];

  if (!Number.isFinite(odds)) passReasons.push('missing_target_book_odds');
  if (!priceInBand) passReasons.push('outside_playable_odds_band');
  if (stale) passReasons.push('stale_row');
  if (!consensusOk) passReasons.push(`consensus_book_count_below_${minConsensusBookCount}`);
  if (!row.lineHistoryUsable) passReasons.push('no_usable_line_history');
  if (!movementLabelSupported) passReasons.push(`movement_not_supportive_${row.movementLabel || 'unknown'}`);
  if (sourceIsTargetBook) passReasons.push('movement_source_is_target_book');
  if (row.movementMode && row.movementMode !== 'same_book') passReasons.push(`movement_mode_${row.movementMode}`);
  if (!movementSourceBook) passReasons.push('missing_movement_source_book');

  const movementScore = movementIsSharpSourced ? 40 * clamp(Number(row.movementQualityScore || 0.75), 0.35, 1) : 0;
  const consensusScore = clamp(consensusBookCount / Math.max(minConsensusBookCount, 1), 0, 2) * 12.5;
  const edge = parseFiniteNumber(row.consensusEdge);
  const edgeScore = edge === null ? 0 : clamp(edge, -5, 5) * 2 + 10;
  const freshnessScore = stale ? 0 : 10;
  const marketScore = row.gatePassed || row.isActionable ? 5 : 0;
  const sharpPlayScore = Number((movementScore + consensusScore + edgeScore + freshnessScore + marketScore).toFixed(3));

  let verdict = 'Pass';
  if (movementIsSharpSourced && consensusOk && priceInBand && !stale) {
    verdict = 'Bet candidate';
  } else if (!strict && movementIsSharpSourced && priceInBand && !stale) {
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

function buildSharpPlaysFromRankedRows(rows = [], options = {}) {
  const strict = options.strict !== undefined ? Boolean(options.strict) : true;
  const includePasses = Boolean(options.includePasses);
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : 10;
  const seenPlays = new Set();

  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const classification = classifySharpPlay(row, { ...options, strict });
      return {
        ...row,
        verdict: classification.verdict,
        passReasons: classification.passReasons,
        sharpPlayScore: classification.sharpPlayScore,
        sharpPlaySupport: classification.support
      };
    })
    .filter((row) => {
      if (includePasses) return true;
      if (strict) return row.verdict === 'Bet candidate';
      return row.verdict === 'Bet candidate' || row.verdict === 'Lean';
    })
    .sort(
      (left, right) =>
        Number(right.sharpPlayScore || 0) - Number(left.sharpPlayScore || 0) ||
        Number(right.consensusBookCount || 0) - Number(left.consensusBookCount || 0) ||
        Number(right.screenScore || right.tennisScore || 0) - Number(left.screenScore || left.tennisScore || 0)
    )
    .filter((row) => {
      const gameKey = String(row.gameId || row.game_id || row.game || row.matchup || '').trim();
      const executionBook = normalizeBook(row.executionBook || row.targetBook || row.book || row.sharpPlaySupport?.targetBook || options.targetBook || '');
      const marketKey = String(row.scanMarket || row.screenMarket || row.market || row.playType || '').trim();
      const pickKey = String(row.pick || row.selection || row.participant || row.selectionId || row.selection_id || '').trim();
      const lineKey = String(row.line ?? row.points ?? row.handicap ?? row.total ?? '').trim();
      const dedupeKey = [executionBook, gameKey, marketKey, pickKey, lineKey].join('|');
      if (!gameKey || !executionBook || !pickKey) return true;
      if (seenPlays.has(dedupeKey)) return false;
      seenPlays.add(dedupeKey);
      return true;
    });

  return candidates.slice(0, limit);
}

module.exports = {
  buildSharpPlaysFromRankedRows,
  classifySharpPlay,
  normalizeList,
  resolveSharpPlayLeagues,
  resolveSharpPlayMarkets,
  resolveTargetBook,
  resolveTargetBooks,
  uniqueBooks
};
