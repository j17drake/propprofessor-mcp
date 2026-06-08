'use strict';

/**
 * screen-utils.js — Barrel module
 *
 * Re-exports all screen utility functions from the split modules.
 * Keeps backward compatibility with every existing import path.
 *
 * Split module structure:
 *   - screen-parser.js   → parsing/extraction functions
 *   - screen-ranker.js   → ranking/scoring/gating functions
 *   - screen-summary.js  → summarization/classification functions
 *   - screen-tennis.js   → tennis-specific functions
 *   - propprofessor-shared-utils.js → shared normalization utilities
 */

const {
  americanOddsToImpliedProbability,
  matchesPreferredBook,
  normalizeDirection,
  normalizeLeagueName,
  normalizeMarketName
} = require('./propprofessor-shared-utils');

const {
  extractHistoryTrail,
  extractScreenRows,
  parseBetPrompt
} = require('./screen-parser');

const {
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate,
  rankLeagueScreenRows,
  rankScreenRows
} = require('./screen-ranker');

const {
  summarizeFreshness
} = require('./screen-summary');

const {
  enrichTennisEvCandidates,
  isTennisRow,
  normalizeTennisMarketQuery,
  rankTennisScreenRows
} = require('./screen-tennis');

module.exports = {
  // Re-exports from shared-utils
  americanOddsToImpliedProbability,
  matchesPreferredBook,
  normalizeDirection,
  normalizeLeagueName,
  normalizeMarketName,

  // From screen-parser
  extractHistoryTrail,
  extractScreenRows,
  parseBetPrompt,

  // From screen-summary
  summarizeFreshness,

  // From screen-tennis
  enrichTennisEvCandidates,
  isTennisRow,
  normalizeTennisMarketQuery,
  rankTennisScreenRows,

  // From screen-ranker
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate,
  rankLeagueScreenRows,
  rankScreenRows
};
