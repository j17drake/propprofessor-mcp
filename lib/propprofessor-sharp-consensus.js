'use strict';

/**
 * Sharp Consensus Multi-Window Analyzer.
 *
 * Segments line history across multiple time windows to detect sustained
 * sharp book movement. Instead of a single lookback verdict, this shows
 * whether Pinnacle, BetOnline, and BookMaker all agree within 1h, 2h, 6h,
 * 12h, 24h, and 48h windows.
 */

const DEFAULT_WINDOWS = [1, 2, 6, 12, 24, 48];
const DEFAULT_SHARP_BOOKS = ['Pinnacle', 'BetOnline', 'BookMaker'];

function getOddsDirection(opening, current) {
  if (opening === null || opening === undefined || current === null || current === undefined) {
    return null;
  }
  // current < opening = supportive (odds moving toward the pick)
  return current < opening ? 'supportive' : 'adverse';
}

function getDirectionPct(opening, current) {
  if (!opening || opening === 0) return 0;
  return Math.round(Math.abs(opening - current) / Math.abs(opening) * 1000) / 10;
}

function segmentWindows(historyPoints, windows, nowMs) {
  const result = {};
  for (const w of windows) {
    const cutoff = nowMs - (w * 60 * 60 * 1000);
    const inWindow = historyPoints.filter((h) => (h.time || 0) >= cutoff);
    if (inWindow.length < 2) continue;

    const opening = inWindow[0].odds;
    const current = inWindow[inWindow.length - 1].odds;
    const direction = getOddsDirection(opening, current);
    if (!direction) continue;

    result[`${w}h`] = {
      direction,
      pct: getDirectionPct(opening, current),
      opening,
      current,
      pointCount: inWindow.length
    };
  }
  return result;
}

function analyzeMultiWindow(rows, options = {}) {
  const {
    windows = DEFAULT_WINDOWS,
    sharpBooks = DEFAULT_SHARP_BOOKS,
    nowMs = Date.now(),
    minConsensusWindows = 0,
    includeExecutionBook = false
  } = options;

  const results = [];
  let skippedNoHistory = 0;
  let skippedInsufficientBooks = 0;

  for (const row of rows) {
    const pick = row.participant || '?';
    const homeTeam = row.homeTeam || '?';
    const awayTeam = row.awayTeam || '?';
    const gameId = row.gameId || '';
    const start = row.start || '?';
    const score = Number(row.screenScore || 0) || 0;
    const history = Array.isArray(row.filteredLineHistory) && row.filteredLineHistory.length
      ? row.filteredLineHistory
      : Array.isArray(row.lineHistory)
        ? row.lineHistory
        : [];

    if (!history.length) {
      skippedNoHistory += 1;
      continue;
    }

    // Extract execution book odds if requested
    let executionBookOdds = null;
    if (includeExecutionBook && row.selections) {
      for (const key of Object.keys(row.selections)) {
        const sel = row.selections[key];
        const execOdds = sel.odds?.[row.book];
        if (execOdds) {
          executionBookOdds = sel.selection1 === pick ? execOdds.odds1 : execOdds.odds2;
          break;
        }
      }
    }

    // Segment each sharp book's history into windows
    const bookWindows = {};
    for (const sb of sharpBooks) {
      const sbHistory = history.filter((h) => h.book === sb);
      if (sbHistory.length < 2) continue;

      const wr = segmentWindows(sbHistory, windows, nowMs);
      if (Object.keys(wr).length > 0) {
        bookWindows[sb] = wr;
      }
    }

    if (!Object.keys(bookWindows).length) {
      skippedInsufficientBooks += 1;
      continue;
    }

    // Count supportive windows per book
    const bookSupportiveCount = {};
    for (const [sb, wr] of Object.entries(bookWindows)) {
      bookSupportiveCount[sb] = Object.values(wr).filter((w) => w.direction === 'supportive').length;
    }

    // Consensus: which windows have ALL sharp books supportive?
    const consensusWindows = [];
    for (const w of windows) {
      const wk = `${w}h`;
      const allSupportive = Object.keys(bookWindows).every(
        (sb) => bookWindows[sb][wk] && bookWindows[sb][wk].direction === 'supportive'
      );
      if (allSupportive) consensusWindows.push(wk);
    }

    const totalSupportive = Object.values(bookSupportiveCount).reduce((a, b) => a + b, 0);
    const totalWindows = Object.values(bookWindows).reduce((a, b) => a + Object.keys(b).length, 0);

    // Filter by minimum consensus
    if (consensusWindows.length < minConsensusWindows) continue;

    results.push({
      pick,
      gameId,
      game: `${homeTeam} vs ${awayTeam}`,
      start,
      executionBookOdds,
      score,
      bookWindows,
      bookSupportiveCount,
      consensusWindows,
      totalSupportive,
      totalWindows
    });
  }

  // Sort by consensus windows count, then total supportive, then score
  results.sort((a, b) => {
    if (b.consensusWindows.length !== a.consensusWindows.length) {
      return b.consensusWindows.length - a.consensusWindows.length;
    }
    if (b.totalSupportive !== a.totalSupportive) {
      return b.totalSupportive - a.totalSupportive;
    }
    return b.score - a.score;
  });

  return {
    results,
    skippedNoHistory,
    skippedInsufficientBooks,
    totalInputRows: rows.length
  };
}

function summarizeResults(results) {
  return {
    veryStrong: results.filter((r) => r.consensusWindows.length >= 4).length,
    strong: results.filter((r) => r.consensusWindows.length >= 2 && r.consensusWindows.length < 4).length,
    good: results.filter((r) => r.totalSupportive >= 3 && r.consensusWindows.length < 2).length,
    mixed: results.filter((r) => r.totalSupportive >= 1 && r.totalSupportive < 3).length,
    adverse: results.filter((r) => r.totalSupportive === 0).length
  };
}

module.exports = {
  DEFAULT_WINDOWS,
  DEFAULT_SHARP_BOOKS,
  getOddsDirection,
  getDirectionPct,
  segmentWindows,
  analyzeMultiWindow,
  summarizeResults
};
