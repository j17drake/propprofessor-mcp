'use strict';

/**
 * Realistic odds history fixtures for offline testing.
 * Models line movement patterns: steam moves, gradual drift, stable lines.
 */

const NOW_SEC = Math.floor(Date.now() / 1000);
const HOUR = 3600;

/**
 * Steam move: Lakers line moved from -120 to -150 over 6 hours at sharp books.
 * Pattern: gradual tightening with a sharp jump at hour 3.
 */
function makeLakersHistory() {
  return {
    Pinnacle: [
      { odds: -120, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -125, start_ts: NOW_SEC - 5 * HOUR },
      { odds: -128, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -135, start_ts: NOW_SEC - 3 * HOUR },
      { odds: -145, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -148, start_ts: NOW_SEC - 1 * HOUR },
      { odds: -150, start_ts: NOW_SEC }
    ],
    Circa: [
      { odds: -118, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -122, start_ts: NOW_SEC - 5 * HOUR },
      { odds: -130, start_ts: NOW_SEC - 3 * HOUR },
      { odds: -140, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -145, start_ts: NOW_SEC }
    ],
    BetOnline: [
      { odds: -122, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -130, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -142, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -152, start_ts: NOW_SEC }
    ],
    NoVigApp: [
      { odds: -120, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -130, start_ts: NOW_SEC - 3 * HOUR },
      { odds: -148, start_ts: NOW_SEC }
    ]
  };
}

/**
 * Sharp movement at Fliff's stale price: Warriors line at Fliff stuck at -120
 * while sharp books moved to -140. This is the classic "sharp play" signal.
 */
function makeWarriorsHistory() {
  return {
    Pinnacle: [
      { odds: -110, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -118, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -128, start_ts: NOW_SEC - 3 * HOUR },
      { odds: -135, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -140, start_ts: NOW_SEC }
    ],
    Circa: [
      { odds: -108, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -120, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -130, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -138, start_ts: NOW_SEC }
    ],
    BetOnline: [
      { odds: -112, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -125, start_ts: NOW_SEC - 3 * HOUR },
      { odds: -138, start_ts: NOW_SEC - 1 * HOUR },
      { odds: -142, start_ts: NOW_SEC }
    ],
    // Fliff hasn't moved — this is the lagging book
    Fliff: [
      { odds: -110, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -120, start_ts: NOW_SEC - 4 * HOUR }
    ],
    NoVigApp: [
      { odds: -110, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -120, start_ts: NOW_SEC }
    ]
  };
}

/**
 * Stable line: Bucks-Heat barely moved. No signal.
 */
function makeBucksHistory() {
  return {
    Pinnacle: [
      { odds: -110, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -112, start_ts: NOW_SEC }
    ],
    Circa: [
      { odds: -108, start_ts: NOW_SEC - 6 * HOUR },
      { odds: -108, start_ts: NOW_SEC }
    ]
  };
}

/**
 * Map from gameId to its odds history fixture.
 * Used by the mock client to return the right history per game.
 */
const HISTORY_BY_GAME = {
  'nba-20260610-lal-bos': makeLakersHistory(),
  'nba-20260610-gsw-den': makeWarriorsHistory(),
  'nba-20260610-mil-mia': makeBucksHistory(),
  'mlb-20260610-nyy-bos': {
    Pinnacle: [
      { odds: -155, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -165, start_ts: NOW_SEC - 2 * HOUR },
      { odds: -170, start_ts: NOW_SEC }
    ],
    Circa: [
      { odds: -150, start_ts: NOW_SEC - 4 * HOUR },
      { odds: -160, start_ts: NOW_SEC }
    ]
  }
};

module.exports = {
  makeLakersHistory,
  makeWarriorsHistory,
  makeBucksHistory,
  HISTORY_BY_GAME
};
