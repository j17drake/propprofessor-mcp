'use strict';

function buildMetaTools() {
  return [
    {
      name: 'ask',
      description:
        'Parse a natural language betting query into structured components (league, book, market, side, line, player) and suggest the best tool to call. Works as a query router — agents call this first, then call the suggested tool immediately. Routes to the right tool: book queries → quick_screen, player queries → player_context, validation queries ("should I bet X?") → validate_play guidance, general → recommended_bets. Examples: "best plays on Fliff today" → quick_screen(books=["Fliff"]), "Tatum over 29.5 points" → player_context(player="Tatum", sport="NBA"), "should I bet Tatum?" → validate_play workflow guidance, "show me MLB moneyline picks" → recommended_bets(leagues=["MLB"], markets=["Moneyline"]). No data is fetched by this tool itself — it\'s a pure parser + router.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with query="best plays on Fliff tonight".',
        properties: {
          query: {
            type: 'string',
            description:
              'Natural language betting query, e.g. "best plays on Fliff today", "Tatum over 29.5 points", "what should I bet on Novig tonight". Full sentence or shorthand both fine.'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'get_market_registry',
      description:
        'Returns the list of markets available for a sport on a specific book. Use this BEFORE calling quick_screen to know which markets to query. Soccer uses Draw No Bet / Match Handicap / Total Goals (not Moneyline / Spread / Total). Tennis uses Game Handicap / Set Handicap / Total Games (not Spread / Total). RECOMMENDED WORKFLOW: (1) get_market_registry → (2) quick_screen(leagues, markets=[...]) → (3) validate_play on top candidates → (4) log_pick.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with sport="Soccer".',
        properties: {
          sport: { type: 'string', description: 'Sport name (e.g. Soccer, NBA, Tennis)' },
          book: {
            type: 'string',
            description: 'Book name (e.g. NoVigApp, DraftKings). If omitted, returns default markets for the sport.'
          }
        },
        required: ['sport'],
        additionalProperties: false
      }
    },
    {
      name: 'get_started',
      description:
        'Get the recommended workflow based on use case. Call this first to understand which tools to use for quick situational checks, deeper signal analysis, or full raw data research. The "casual"/"intermediate"/"sharp" labels are about *data depth*, not about betting style — every level surfaces the same underlying signal feed, just with more or less aggregation.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with user_type="casual".',
        properties: {
          user_type: {
            type: 'string',
            enum: ['casual', 'intermediate', 'sharp'],
            description:
              'casual: just wants top picks with plain English. intermediate: understands edge/tier, wants guidance. sharp: wants full movement data and control.'
          }
        },
        required: ['user_type'],
        additionalProperties: false
      }
    },
    {
      name: 'league_presets',
      description:
        'Show the current sport-specific ranking presets — which books count as sharp per league, the default market bundles, and the preferred execution book. Call BEFORE `screen_ranked`, `recommended_bets`, or `validate_play` when you want to know which books/markets will be weighted highest, or when debugging unexpected ranking behavior. No arguments needed; result is informational only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false, usage_example: 'Call with no args.' }
    },
    {
      name: 'health_status',
      description:
        'Check auth freshness and endpoint connectivity. Reports token persistence state: `persistedToDisk` (boolean), `refreshCount` (number of refreshes since startup), and `lastRefreshed` (ISO timestamp). Call FIRST THING on session boot to confirm the MCP server can reach the PropProfessor backend. If `persistedToDisk=false` or `lastRefreshed` is over 1 hour ago, expect auth failures on subsequent tool calls — surface `pp-query login` to the user. No arguments needed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false, usage_example: 'Call with no args.' }
    },
    {
      name: 'fantasy_optimizer',
      description:
        'Query the Fantasy Optimizer for DFS-style player picks across fantasy apps (PrizePicks, Underdog, etc.). Returns fantasy plays with projected values, odds, and risk metrics. Requires a paid PropProfessor subscription with Fantasy Optimizer access.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with fantasyApps=["PrizePicks","Underdog"], leagues=["NBA"].',
        properties: {
          fantasyApps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fantasy apps to query, e.g., ["PrizePicks", "Underdog", "DraftKings6"].'
          },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'League filter, e.g., ["NBA", "MLB"]. Defaults to NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC — every league the PropProfessor backend supports.'
          },
          market: { type: 'string', description: 'Market filter, e.g., "Fantasy Points".' },
          sportsbooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sportsbooks to compare (fallback for fantasy apps without odds).'
          },
          minOdds: { type: 'number', description: 'Minimum American odds.' },
          maxOdds: { type: 'number', description: 'Maximum American odds.' },
          minValue: { type: 'number', description: 'Minimum projected value (percentage).' },
          maxValue: { type: 'number', description: 'Maximum projected value (percentage).' },
          minLegEV: { type: 'number', description: 'Minimum leg EV threshold.' },
          maxLegEV: { type: 'number', description: 'Maximum leg EV threshold.' },
          minSlipEV: { type: 'number', description: 'Minimum slip EV threshold.' },
          maxSlipEV: { type: 'number', description: 'Maximum slip EV threshold.' },
          hiddenBets: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of hidden bet objects to exclude from results.'
          }
        },
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildMetaTools };
