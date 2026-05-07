'use strict';

const DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS = 6;

function getLocalTimezone() {
  return process.env.LOCAL_TIMEZONE || 'America/Chicago';
}

function getOddsHistoryLookbackHours(value = process.env.PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS;
}

module.exports = {
  DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS,
  getLocalTimezone,
  getOddsHistoryLookbackHours
};
