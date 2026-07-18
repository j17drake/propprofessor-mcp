'use strict';

function buildMetaTools() {
  return [
    {
      name: 'ask',
      description:
        'Parse a natural language betting query and return the parsed components plus a suggested tool and args. Pure parser + router — no data is fetched by this tool. The calling agent should then call the suggested tool.',
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
        'Returns markets available for a sport on a specific book. Use before quick_screen to know which markets to query.',
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
        'Get the recommended workflow based on use case (casual/intermediate/sharp). Call first to understand which tools to use.',
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
        'Show current sport-specific ranking presets: sharp books per league, default market bundles, and preferred execution book.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false, usage_example: 'Call with no args.' }
    },
    {
      name: 'health_status',
      description:
        'Check auth freshness and endpoint connectivity. Reports token persistence state: persistedToDisk, refreshCount, and lastRefreshed.',
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
    },
    {
      name: 'today',
      description:
        'One-call daily briefing: the current sharp slate (top plays by consensus edge), your pending logged picks, and your recent betting stats (win rate / P&L). Replaces three separate calls (quick_screen + get_pick_history + get_pick_stats).',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with leagues=["WNBA","NBA"], book="NoVigApp", limit=10.',
        properties: {
          leagues: { type: 'array', items: { type: 'string' }, description: 'Leagues to include (default NBA, WNBA, MLB, NFL)' },
          league: { type: 'string', description: 'Single league shortcut (alternative to leagues)' },
          book: { type: 'string', description: 'Sportsbook to screen (default NoVigApp)' },
          limit: { type: 'number', description: 'Max plays to return from the slate (default 10)' },
          statsDays: { type: 'number', description: 'Window for the stats block (default 30)' }
        },
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildMetaTools };
