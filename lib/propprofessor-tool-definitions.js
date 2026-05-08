'use strict';

const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('./propprofessor-mcp-ranked-screen');

function buildToolDefinitions() {
  return [
    {
      name: 'query_positive_ev_candidates',
      description:
        'Query the sportsbook +EV endpoint and return candidate plays for enabled books. Best used as a fast discovery layer before validating finalists with /screen and odds-history movement.',
      inputSchema: {
        type: 'object',
        properties: {
          sportsbooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional target books such as Fliff, NoVigApp, FanDuel, or DraftKings'
          },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional league filters such as NBA, MLB, NHL, NFL, Tennis, or Soccer'
          },
          marketTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional market-type filters such as Main Lines or Player Props'
          },
          periodTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional period-type filters such as Full Game or Single Period'
          },
          minValue: {
            type: 'number',
            description:
              'Minimum EV/value threshold. Optional here because the frontend Positive EV screen may already enforce this.'
          },
          maxValue: { type: 'number', description: 'Maximum EV/value threshold' },
          minOdds: { type: 'number', description: 'Minimum American odds' },
          maxOdds: { type: 'number', description: 'Maximum American odds' },
          minHoursAway: { type: 'number', description: 'Minimum hours until start' },
          maxHoursAway: { type: 'number', description: 'Maximum hours until start' },
          minLiquidity: { type: 'number', description: 'Minimum liquidity filter' },
          maxLiquidity: { type: 'number', description: 'Maximum liquidity filter' },
          isLive: { type: 'boolean', description: 'Whether to query live +EV rows' },
          showBreakOnly: { type: 'boolean' },
          showTimeoutOnly: { type: 'boolean' },
          showPeriodEndOnly: { type: 'boolean' },
          timeAvailable: { type: 'number' },
          userState: { type: 'string', description: 'User state code, default tx' },
          hideNCAAPlayerProps: { type: 'boolean' },
          weightSettings: { type: 'object', description: 'Optional backend weight-settings override object' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_validated_positive_ev_candidates',
      description:
        'Query sportsbook +EV candidates, then rank them with the same sharp-movement and odds-history logic used for /screen. This is the fast positive-EV finder plus validation pass.',
      inputSchema: {
        type: 'object',
        properties: {
          sportsbooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional target books such as Fliff or NoVigApp'
          },
          leagues: { type: 'array', items: { type: 'string' }, description: 'Optional league filters' },
          marketTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional market-type filters such as Main Lines or Player Props'
          },
          periodTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional period-type filters such as Full Game or Single Period'
          },
          minValue: {
            type: 'number',
            description:
              'Optional minimum EV/value threshold. Leave unset if the frontend Positive EV screen already enforces it.'
          },
          maxValue: { type: 'number' },
          minOdds: { type: 'number' },
          maxOdds: { type: 'number' },
          minHoursAway: { type: 'number' },
          maxHoursAway: { type: 'number' },
          minLiquidity: { type: 'number' },
          maxLiquidity: { type: 'number' },
          isLive: { type: 'boolean' },
          showBreakOnly: { type: 'boolean' },
          showTimeoutOnly: { type: 'boolean' },
          showPeriodEndOnly: { type: 'boolean' },
          timeAvailable: { type: 'number' },
          userState: { type: 'string' },
          hideNCAAPlayerProps: { type: 'boolean' },
          weightSettings: { type: 'object' },
          league: {
            type: 'string',
            description: 'Optional ranking league override when validating a single-sport candidate set'
          },
          market: {
            type: 'string',
            description: 'Optional ranking market override when validating a single-market candidate set'
          },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional sharp-book override for validation and odds-history queries'
          },
          limit: { type: 'number', description: 'Max number of validated rows to return' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          lookbackHours: {
            type: 'number',
            description: `Odds-history lookback window in hours, default ${DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS}`
          },
          debug: {
            type: 'boolean',
            description:
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default true'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_screen_odds',
      description:
        'Query the live Odds Screen payload from /screen with the current league, market, game, and participant filters.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          league: { type: 'string', description: 'League such as NBA' },
          games: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional game ids from the screen dropdown'
          },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional display books filter' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },

    {
      name: 'query_screen_odds_best_comps',
      description:
        'Query /screen using a sharper default comparison set. Defaults to Pinnacle, Polymarket, Kalshi, BetOnline, and Circa cross-sport, switches NBA and NFL to the Dec 2024 Pikkit hierarchy, and switches MLB to the PromoGuy/Pikkit MLB hierarchy.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          league: { type: 'string' },
          games: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'string' } },
          books: { type: 'array', items: { type: 'string' } },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_screen_odds_ranked',
      description:
        'Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata for any market.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Odds screen market, for example Moneyline or Player Points' },
          league: { type: 'string', description: 'League such as NBA' },
          games: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional game ids or identifiers to filter the query'
          },
          participants: { type: 'array', items: { type: 'string' }, description: 'Optional participant filters' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          lookbackHours: {
            type: 'number',
            description: `Odds-history lookback window in hours, default ${DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS}`
          },
          debug: {
            type: 'boolean',
            description:
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default true'
          },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_sport_screen',
      description: 'Query /screen for any supported league and return league-specific ranked rows.',
      inputSchema: {
        type: 'object',
        properties: {
          league: {
            type: 'string',
            description: 'Supported league such as NBA, WNBA, MLB, NFL, NHL, soccer, NCAAB, NCAAF, or Tennis'
          },
          market: { type: 'string', description: 'Optional market filter, default Moneyline' },
          limit: { type: 'number', description: 'Max number of ranked rows to return' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional comparison books override' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          lookbackHours: {
            type: 'number',
            description: `Odds-history lookback window in hours, default ${DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS}`
          },
          debug: {
            type: 'boolean',
            description:
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default true'
          },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'query_nba_screen',
      description: 'Query /screen for NBA and return ranked rows with NBA presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_wnba_screen',
      description: 'Query /screen for WNBA and return ranked rows with WNBA presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_mlb_screen',
      description: 'Query /screen for MLB and return ranked rows with MLB presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nfl_screen',
      description: 'Query /screen for NFL and return ranked rows with NFL presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_nhl_screen',
      description: 'Query /screen for NHL and return ranked rows with NHL presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_soccer_screen',
      description: 'Query /screen for soccer and return ranked rows with soccer presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaab_screen',
      description: 'Query /screen for NCAAB and return ranked rows with NCAAB presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_ncaaf_screen',
      description: 'Query /screen for NCAAF and return ranked rows with NCAAF presets.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          limit: { type: 'number' },
          books: { type: 'array', items: { type: 'string' } },
          includeAll: { type: 'boolean' },
          maxAgeMs: { type: 'number' },
          lookbackHours: { type: 'number' },
          debug: { type: 'boolean' },
          is_live: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'query_tennis_screen',
      description: 'Query /screen for tennis and return the top ranked tennis plays.',
      inputSchema: {
        type: 'object',
        properties: {
          market: {
            type: 'string',
            description: 'Optional market filter, default Moneyline. Use Moneyline, Spread, or Total.'
          },
          limit: { type: 'number', description: 'Max number of ranked plays to return' },
          book: {
            type: 'string',
            description: 'Preferred book to rank, default Pinnacle. Set to Fliff for Fliff-only results.'
          },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filters for the backend query'
          },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          lookbackHours: {
            type: 'number',
            description: `Odds-history lookback window in hours, default ${DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS}`
          },
          debug: {
            type: 'boolean',
            description:
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default true'
          },
          is_live: { type: 'boolean', description: 'Whether to query live tennis odds' }
        },
        additionalProperties: false
      }
    },

    {
      name: 'league_presets',
      description: 'Return the current sport-specific ranking presets used by screen ranking.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'health_status',
      description: 'Check auth freshness and confirm the PropProfessor screen endpoint responds.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildToolDefinitions };
