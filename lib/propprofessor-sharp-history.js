'use strict';

function americanOddsToImpliedProbability(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return (-n) / ((-n) + 100);
}

function normalizeBook(value) {
  return String(value || '').trim();
}

function parseHistoryTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseFiniteOdds(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseFiniteLine(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sortHistoryPoints(points) {
  return [...(Array.isArray(points) ? points : [])]
    .map((point, index) => ({
      ...point,
      __historyIndex: Number.isFinite(Number(point?.__historyIndex)) ? Number(point.__historyIndex) : index,
      __timeMs: parseHistoryTimeMs(point?.time)
    }))
    .sort((left, right) => {
      const leftHasTime = Number.isFinite(left.__timeMs);
      const rightHasTime = Number.isFinite(right.__timeMs);
      if (leftHasTime && rightHasTime && left.__timeMs !== right.__timeMs) return left.__timeMs - right.__timeMs;
      if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
      return left.__historyIndex - right.__historyIndex;
    });
}

function groupHistoryPointsByBook(points) {
  const grouped = {};
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || typeof point !== 'object') continue;
    const odds = parseFiniteOdds(point.odds);
    if (!Number.isFinite(odds)) continue;
    const book = normalizeBook(point.book);
    if (!grouped[book]) grouped[book] = [];
    grouped[book].push({ ...point, odds, book });
  }
  for (const [book, entries] of Object.entries(grouped)) {
    grouped[book] = sortHistoryPoints(entries).map(entry => {
      const copy = { ...entry };
      delete copy.__historyIndex;
      delete copy.__timeMs;
      return copy;
    });
  }
  return grouped;
}

function filterHistoryPoints(points, options = {}) {
  const maxAbsOdds = Number.isFinite(Number(options.maxAbsOdds)) ? Math.abs(Number(options.maxAbsOdds)) : 1500;
  const normalized = (Array.isArray(points) ? points : []).map((point, index) => ({
    ...(point && typeof point === 'object' ? point : { odds: point }),
    odds: parseFiniteOdds(point?.odds ?? point),
    book: normalizeBook(point?.book),
    __historyIndex: index
  }));
  const droppedPoints = [];
  const interimKept = [];
  const dropReasons = {};

  function recordDrop(point, reason) {
    droppedPoints.push({ point, reason });
    dropReasons[reason] = (dropReasons[reason] || 0) + 1;
  }

  for (const point of normalized) {
    if (!Number.isFinite(point.odds)) {
      recordDrop(point, 'non_finite_odds');
      continue;
    }
    if (Math.abs(point.odds) > maxAbsOdds) {
      recordDrop(point, 'outlier_odds');
      continue;
    }
    interimKept.push(point);
  }

  const grouped = groupHistoryPointsByBook(interimKept);
  const keptPoints = [];
  for (const entries of Object.values(grouped)) {
    let previous = null;
    for (const entry of entries) {
      const duplicate = previous
        && previous.odds === entry.odds
        && parseFiniteLine(previous.line) === parseFiniteLine(entry.line);
      if (duplicate) {
        recordDrop(entry, 'duplicate_consecutive');
        continue;
      }
      previous = entry;
      keptPoints.push({ ...entry, __historyIndex: entry.__historyIndex });
    }
  }

  const sortedKeptPoints = sortHistoryPoints(keptPoints).map(point => {
    const copy = { ...point };
    delete copy.__historyIndex;
    delete copy.__timeMs;
    return copy;
  });

  return {
    keptPoints: sortedKeptPoints,
    droppedPoints,
    droppedCount: droppedPoints.length,
    dropReasons
  };
}

function directionFromClvPct(value) {
  if (!Number.isFinite(value)) return 'insufficient_history';
  if (value > 0.01) return 'supportive';
  if (value < -0.01) return 'adverse';
  return 'mixed';
}

function computeClvPct(openingOdds, currentOdds) {
  const openingProb = americanOddsToImpliedProbability(openingOdds);
  const currentProb = americanOddsToImpliedProbability(currentOdds);
  if (!Number.isFinite(openingProb) || !Number.isFinite(currentProb)) return null;
  return (currentProb - openingProb) * 100;
}

function buildMovementWindows(points, options = {}) {
  const sortedPoints = sortHistoryPoints((Array.isArray(points) ? points : []).filter(point => Number.isFinite(Number(point?.odds))));
  const recentWindowHours = Number.isFinite(Number(options.recentWindowHours)) && Number(options.recentWindowHours) > 0
    ? Number(options.recentWindowHours)
    : 6;
  const nowMs = Number.isFinite(Number(options.nowMs))
    ? Number(options.nowMs)
    : (sortedPoints.length && Number.isFinite(sortedPoints[sortedPoints.length - 1].__timeMs)
      ? sortedPoints[sortedPoints.length - 1].__timeMs
      : Date.now());

  const fullWindow = sortedPoints.length >= 2
    ? {
        openingOdds: sortedPoints[0].odds,
        currentOdds: sortedPoints[sortedPoints.length - 1].odds,
        pointCount: sortedPoints.length,
        clvPct: computeClvPct(sortedPoints[0].odds, sortedPoints[sortedPoints.length - 1].odds),
        direction: directionFromClvPct(computeClvPct(sortedPoints[0].odds, sortedPoints[sortedPoints.length - 1].odds))
      }
    : null;

  const recentCutoffMs = nowMs - recentWindowHours * 60 * 60 * 1000;
  const recentCandidates = sortedPoints.filter(point => Number.isFinite(point.__timeMs) && point.__timeMs >= recentCutoffMs);
  const recentWindow = recentCandidates.length >= 2
    ? {
        openingOdds: recentCandidates[0].odds,
        currentOdds: recentCandidates[recentCandidates.length - 1].odds,
        pointCount: recentCandidates.length,
        clvPct: computeClvPct(recentCandidates[0].odds, recentCandidates[recentCandidates.length - 1].odds),
        direction: directionFromClvPct(computeClvPct(recentCandidates[0].odds, recentCandidates[recentCandidates.length - 1].odds)),
        windowHours: recentWindowHours
      }
    : null;

  return {
    fullWindow,
    recentWindow,
    pointCount: sortedPoints.length,
    points: sortedPoints.map(point => {
      const copy = { ...point };
      delete copy.__historyIndex;
      delete copy.__timeMs;
      return copy;
    })
  };
}

function pickMovementSource(groupedPoints, { preferredBook, sharpBooks = [], allowMixedFallback = true } = {}) {
  const preferred = normalizeBook(preferredBook);
  const namedBooks = Object.keys(groupedPoints || {}).filter(book => book && groupedPoints[book]?.length >= 2);
  const sharpBookList = Array.from(new Set((Array.isArray(sharpBooks) ? sharpBooks : []).map(normalizeBook).filter(Boolean)));

  if (preferred && groupedPoints[preferred]?.length >= 2) {
    return { movementMode: 'same_book', movementSourceBook: preferred, points: groupedPoints[preferred] };
  }

  for (const sharpBook of sharpBookList) {
    if (groupedPoints[sharpBook]?.length >= 2) {
      return { movementMode: 'same_book', movementSourceBook: sharpBook, points: groupedPoints[sharpBook] };
    }
  }

  for (const book of namedBooks) {
    return { movementMode: 'same_book', movementSourceBook: book, points: groupedPoints[book] };
  }

  const allPoints = sortHistoryPoints(Object.values(groupedPoints || {}).flat());
  if (allowMixedFallback && allPoints.length >= 2) {
    return {
      movementMode: 'mixed_books_fallback',
      movementSourceBook: null,
      points: allPoints.map(point => {
        const copy = { ...point };
        delete copy.__historyIndex;
        delete copy.__timeMs;
        return copy;
      })
    };
  }

  return { movementMode: 'none', movementSourceBook: null, points: [] };
}

function getMovementLabel({ fullDirection, recentDirection, lineHistoryUsable }) {
  if (!lineHistoryUsable) return 'insufficient_history';
  if (fullDirection === 'supportive' && (recentDirection === 'supportive' || recentDirection === 'insufficient_history')) return 'supportive';
  if (fullDirection === 'adverse' && recentDirection === 'supportive') return 'recent_supportive_only';
  if (fullDirection === 'adverse' && (recentDirection === 'adverse' || recentDirection === 'insufficient_history')) return 'adverse';
  if (fullDirection === 'supportive' && recentDirection === 'adverse') return 'mixed';
  if (fullDirection === 'mixed' || recentDirection === 'mixed') return 'mixed';
  if (recentDirection === 'supportive' && fullDirection === 'insufficient_history') return 'recent_supportive_only';
  return fullDirection || 'insufficient_history';
}

function getMovementQuality({ movementMode, movementSourceBook, sharpBooks = [], movementPointCount, droppedCount }) {
  const sharpSet = new Set((Array.isArray(sharpBooks) ? sharpBooks : []).map(normalizeBook).filter(Boolean));
  const pointCount = Number(movementPointCount) || 0;
  const usedSharpBook = Boolean(movementSourceBook && sharpSet.has(normalizeBook(movementSourceBook)));

  if (movementMode === 'none' || pointCount < 2) {
    return { movementQuality: 'none', movementQualityScore: 0 };
  }
  if (movementMode === 'mixed_books_fallback') {
    return { movementQuality: 'low', movementQualityScore: 0.35 };
  }
  if (usedSharpBook && pointCount >= 2 && droppedCount <= 1) {
    return { movementQuality: 'high', movementQualityScore: droppedCount === 0 ? 0.95 : 0.9 };
  }
  if (pointCount >= 2) {
    return { movementQuality: 'medium', movementQualityScore: usedSharpBook ? 0.75 : 0.6 };
  }
  return { movementQuality: 'low', movementQualityScore: 0.35 };
}

function summarizeSharpMovement({ lineHistory, preferredBook, sharpBooks, options = {} }) {
  const originalPoints = Array.isArray(lineHistory) ? lineHistory : [];
  const filtered = filterHistoryPoints(originalPoints, options);
  const grouped = groupHistoryPointsByBook(filtered.keptPoints);
  const source = pickMovementSource(grouped, {
    preferredBook,
    sharpBooks,
    allowMixedFallback: options.allowMixedFallback !== false
  });
  const windows = buildMovementWindows(source.points, options);
  const fullDirection = windows.fullWindow?.direction || 'insufficient_history';
  const recentDirection = windows.recentWindow?.direction || 'insufficient_history';
  const lineHistoryUsable = Boolean(windows.fullWindow && Number.isFinite(windows.fullWindow.clvPct));
  const movementLabel = getMovementLabel({ fullDirection, recentDirection, lineHistoryUsable });
  const quality = getMovementQuality({
    movementMode: source.movementMode,
    movementSourceBook: source.movementSourceBook,
    sharpBooks,
    movementPointCount: windows.pointCount,
    droppedCount: filtered.droppedCount
  });

  return {
    filteredLineHistory: filtered.keptPoints,
    filteredHistoryPointCount: filtered.keptPoints.length,
    droppedHistoryPointCount: filtered.droppedCount,
    droppedHistoryPoints: filtered.droppedPoints,
    droppedHistoryReasons: filtered.dropReasons,
    movementSourceBook: source.movementSourceBook,
    movementMode: source.movementMode,
    movementPointCount: windows.pointCount,
    openingOdds: windows.fullWindow?.openingOdds ?? null,
    currentOdds: windows.fullWindow?.currentOdds ?? null,
    openToCurrentClvPct: windows.fullWindow?.clvPct ?? null,
    clvProxyPct: windows.fullWindow?.clvPct ?? null,
    recentClvPct: windows.recentWindow?.clvPct ?? null,
    recentWindowHours: windows.recentWindow?.windowHours ?? (Number.isFinite(Number(options.recentWindowHours)) ? Number(options.recentWindowHours) : 6),
    recentSharpMoveDirection: recentDirection,
    fullWindowSharpMoveDirection: fullDirection,
    movementLabel,
    lineHistoryUsable,
    movementQuality: quality.movementQuality,
    movementQualityScore: quality.movementQualityScore
  };
}

module.exports = {
  buildMovementWindows,
  computeClvPct,
  filterHistoryPoints,
  groupHistoryPointsByBook,
  summarizeSharpMovement
};
