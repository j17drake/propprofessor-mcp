'use strict';

function buildContextTools() {
  return [
    {
      name: 'player_context',
      description:
        'Get recent news, tweets, and a computed risk flag for a player. Use before placing a bet — if riskFlag is high, downgrade or skip the play.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with player="Jayson Tatum", sport="NBA".',
        properties: {
          gameTime: { type: 'string', description: 'Optional ISO timestamp of the game' },
          maxAgeMinutes: { type: 'number', description: 'How far back to search, default 60' },
          player: { type: 'string', description: 'Player full name (e.g., "Frances Tiafoe")' },
          sport: { type: 'string', description: 'Sport name (e.g., "Tennis", "NBA", "MLB")' },
          useXurl: {
            type: 'boolean',
            description: 'Escalate to paid xurl CLI for real-time results. Bypasses cache. Use sparingly.'
          }
        },
        required: ['player'],
        additionalProperties: false
      }
    },
    {
      name: 'mlb_game_context',
      description:
        'Get MLB game-level context: starting pitchers, venue/park factor, weather at first pitch, and lineup lock status. Returns riskFlag for weather/park effects.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with gamePk="824503".',
        properties: {
          gamePk: {
            type: 'string',
            description: 'MLB gamePk (game ID) from a prior screen row, e.g. "824503".'
          }
        },
        required: ['gamePk'],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_consensus',
      description:
        'Analyze line history across multiple time windows (1h–48h) to detect sustained sharp-book consensus movement. Shows WHY a play ranks, not just WHAT ranks.' +
        ' tier/kaiCall/edge/screenScore are signal-quality ratings, not win-probability predictions.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with league="NBA".',
        properties: {
          league: { type: 'string', description: 'League such as Tennis, NBA, MLB' },
          limit: { type: 'number', description: 'Max rows to fetch before analysis, default 100' },
          lookbackHours: { type: 'number', description: 'Total lookback for API query, default 48' },
          market: { type: 'string', description: 'Market filter, default Moneyline' },
          minConsensusWindows: {
            type: 'number',
            description: 'Minimum consensus windows required to include a play, default 0'
          },
          sharpBooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sharp books for consensus, default [Pinnacle, BetOnline, BookMaker]'
          },
          windows: {
            type: 'array',
            items: { type: 'number' },
            description: 'Time windows in hours to segment history, default [1, 2, 6, 12, 24, 48]'
          }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'all_slates',
      description:
        'Query multiple active leagues at once and return a consolidated ranked list. Best for daily discovery: one call instead of 5-6 separate league screens.' +
        ' tier/kaiCall/edge/screenScore are signal-quality ratings, not win-probability predictions.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with leagues=["NBA","MLB"].',
        properties: {
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Specific leagues to query. Default: [NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC] — every league the PropProfessor backend supports.'
          },
          limit: { type: 'number', description: 'Max ranked rows per league (default 15)' },
          lookbackHours: { type: 'number', description: 'Odds-history lookback window in hours, default 6' },
          market: {
            type: 'string',
            description:
              'Market filter applied across all leagues, default Moneyline. Deprecated — prefer the canonical "markets" (plural array) param for multi-market scans. Still accepted for backward compatibility; the handler maps a single market to a one-element array internally.'
          },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Market types to scan. Default: ["Moneyline", "Spread", "Total"]. Overrides `market` if provided.'
          },
          compact: {
            type: 'boolean',
            description:
              'When true, strip verbose payloads (lineHistory, scoreBreakdown, full odds maps) and return only essential fields per match. Reduces response size by ~90%. Default false. Does NOT affect history hydration — movement data is always fetched.'
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of field names to return per row. Overrides compact when both are set. Example: ["game","selection","odds","edge","tier","kai"]'
          },
          skipHistory: {
            type: 'boolean',
            description:
              'When true, skip odds history hydration entirely. Use this to speed up screen calls when you only need current odds/edges and do not need movement data. Default false.'
          },
          include: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of top-level response sections to include. Values: "freshness", "warnings", "resultMeta", "league". Example: ["resultMeta"] to get only ok+result+resultMeta. Default: all sections.'
          },
          verbosity: {
            type: 'string',
            enum: ['minimal', 'standard', 'full'],
            description:
              'Output detail level. minimal: returns {summary: string, count: number, type: "plays"|"no_plays"} — a plain-English summary wrapped in a parseable JSON envelope. standard: structured rows with edge/tier/risk + brief rationale. full: all movement data, line history, debug payloads. Default: standard.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'get_alerts',
      description:
        'Check for new sharp line movements, steam moves, and significant odds changes since you last checked.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with no args.',
        properties: {
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Leagues to check for alerts. Default: NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC — every league the PropProfessor backend supports.'
          },
          lookbackHours: {
            type: 'number',
            description: 'How far back to scan for movement. Default: 6, min: 1, max: 48.'
          },
          minSteamBooks: {
            type: 'number',
            description: 'Minimum sharp books agreeing for a steam alert. Default: 2, max: 5.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'smart_money',
      description:
        'Mirror the website\'s "Smart Money" page: surface the $ volume (sharp action) and per-side odds range for each market — the sharp-money signal the +EV feed hides. Returns volumeUsd + oddsRange per game/market, sorted by biggest sharp action first.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with leagues=["WNBA"] to see where the sharp money is landing.',
        properties: {
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Leagues to scan. Default: NBA, MLB, NHL, WNBA, NFL.'
          },
          league: {
            type: 'string',
            description: 'Single-league shortcut (alias for leagues:[league]).'
          },
          userState: {
            type: 'string',
            description: 'State filter (e.g. "tx"). Default: tx.'
          },
          hideNCAAPlayerProps: {
            type: 'boolean',
            description: 'Hide NCAA player props. Default: false.'
          },
          sportsbooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Restrict to these sportsbooks.'
          },
          marketTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Market types (e.g. ["Main Lines","Player Props"]).'
          },
          periodTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Period types (e.g. ["Full Game"]).'
          },
          minLiquidity: {
            type: 'number',
            description: 'Minimum liquidity filter. Default: 0.'
          },
          minHoursAway: {
            type: 'number',
            description: 'Minimum hours until start. Default: 0.'
          },
          maxHoursAway: {
            type: 'number',
            description: 'Maximum hours until start. Default: 24.'
          }
        },
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildContextTools };
