'use strict';

/**
 * Discovery handlers: ev_candidates, smart_money.
 * Note: all_slates stays inline — it calls handlers.screen_ranked.
 */

const { defined } = require('./handler-utils');

function createDiscoveryHandlers(client, ctx) {
  return {
    async ev_candidates(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues : undefined;
      if (!leagues) {
        const error = new Error('leagues parameter is required on ev_candidates');
        error.code = 'MISSING_LEAGUES';
        error.category = 'validation';
        error.status = 400;
        throw error;
      }
      const payload = await client.querySportsbook(
        defined({
          isLive: false,
          showBreakOnly: args.showBreakOnly,
          showTimeoutOnly: args.showTimeoutOnly,
          showPeriodEndOnly: args.showPeriodEndOnly,
          timeAvailable: args.timeAvailable,
          userState: args.userState,
          hideNCAAPlayerProps: args.hideNCAAPlayerProps,
          minLiquidity: args.minLiquidity,
          minEdge: args.minEdge,
          leagues,
          markets: Array.isArray(args.markets) ? args.markets : undefined,
          limit: args.limit
        })
      );
      return payload;
    },

    async smart_money(args = {}) {
      const leagues = Array.isArray(args.leagues) && args.leagues.length ? args.leagues
        : args.league ? [args.league]
        : ['NBA', 'MLB', 'NHL', 'WNBA', 'NFL'];
      const filters = { leagues, userState: String(args.userState || 'tx').toLowerCase() };
      if (Array.isArray(args.sportsbooks) && args.sportsbooks.length) filters.sportsbooks = args.sportsbooks;
      if (Array.isArray(args.marketTypes) && args.marketTypes.length) filters.marketTypes = args.marketTypes;
      if (Array.isArray(args.periodTypes) && args.periodTypes.length) filters.periodTypes = args.periodTypes;
      if (Number.isFinite(Number(args.minLiquidity))) filters.minLiquidity = Number(args.minLiquidity);
      if (Number.isFinite(Number(args.minHoursAway))) filters.minHoursAway = Number(args.minHoursAway);
      if (Number.isFinite(Number(args.maxHoursAway))) filters.maxHoursAway = Number(args.maxHoursAway);
      if (args.hideNCAAPlayerProps !== undefined) filters.hideNCAAPlayerProps = Boolean(args.hideNCAAPlayerProps);
      let raw;
      try {
        raw = await client.querySmartMoney(filters);
      } catch (err) {
        return { ok: false, error: { code: 'BACKEND_ERROR', message: err?.message || String(err) } };
      }
      const result = Array.isArray(raw) ? raw : raw?.result || [];
      return { ok: true, count: result.length, result, ...(raw?.meta ? { meta: raw.meta } : {}) };
    }
  };
}

module.exports = { createDiscoveryHandlers };
