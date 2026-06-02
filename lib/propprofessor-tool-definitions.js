'use strict';

const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('./propprofessor-mcp-ranked-screen');

function buildToolDefinitions() {
  return [
    {
      name: 'ev_candidates',
      description:
        'Query the sportsbook +EV endpoint and return candidate plays for enabled books. Best used as a fast discovery layer before validating finalists with /screen and odds-history movement. Set validated=true to run sharp-movement validation pass. Returns 0 rows on quiet days when no +EV opportunities exist — that is normal, not a bug.',
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
            description: 'Required league filter, e.g. NBA, MLB, NHL, Tennis, UFC, Soccer. Omitting this will cause a backend 400 error.'
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
          weightSettings: { type: 'object', description: 'Optional backend weight-settings override object' },
          // Validation pass params (from query_validated_positive_ev_candidates)
          validated: {
            type: 'boolean',
            description: 'When true, runs sharp-movement and odds-history validation on candidates. Default false.'
          },
          league: {
            type: 'string',
            description: 'Ranking league override when validating a single-sport candidate set'
          },
          market: {
            type: 'string',
            description: 'Ranking market override when validating a single-market candidate set'
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
      name: 'screen_raw',
      description:
        'Query the live Odds Screen payload from /screen with the current league, market, game, and participant filters. Set bestComps=true to use the sharper default comparison book set (Pinnacle, Polymarket, Kalshi, BetOnline, Circa).',
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
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          bestComps: {
            type: 'boolean',
            description: 'Use sharper default comparison book set (Pinnacle, Polymarket, Kalshi, BetOnline, Circa). Default false.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'screen_ranked',
      description:
        'Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata for any market. This is the primary tool for getting tiered, ranked plays.',
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
          historySportsbooks: { type: 'array', items: { type: 'string' }, description: 'Optional sportsbooks to fetch odds history for (overrides books for history enrichment only)' },
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
      name: 'screen',
      description:
        'Query /screen for any supported league and return league-specific ranked rows. Replaces all per-league screen tools (query_nba_screen, query_mlb_screen, etc.). Use this as the default league screen tool.',
      inputSchema: {
        type: 'object',
        properties: {
          league: {
            type: 'string',
            description: 'Supported league such as NBA, WNBA, MLB, NFL, NHL, UFC, Soccer, NCAAB, NCAAF, or Tennis'
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
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          // Tennis-specific param (from query_tennis_screen)
          book: {
            type: 'string',
            description: 'Tennis only: preferred book to rank, default Pinnacle. Ignored for other leagues.'
          }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_plays',
      description:
        'Add-on scanner for the best target-book plays with supportive sharp movement. Queries /screen across leagues/markets, hydrates odds history, and only treats non-target sharp-book movement as support.',
      inputSchema: {
        type: 'object',
        properties: {
          targetBooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Target execution books to scan together, such as ["Fliff", "NoVigApp"]'
          },
          targetBooksCsv: { type: 'string', description: 'Comma-separated alias for targetBooks, for dashboard URLs' },
          book: { type: 'string', description: 'Legacy single target execution book such as Fliff, NoVigApp, or Rebet' },
          targetBook: { type: 'string', description: 'Alias for book' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Leagues to scan, default NBA, MLB, NHL, Tennis, and WNBA'
          },
          league: { type: 'string', description: 'Single league shortcut' },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Markets to scan, default Moneyline'
          },
          market: { type: 'string', description: 'Single market shortcut' },
          sharpBooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional non-target sharp comparison books override'
          },
          limit: { type: 'number', description: 'Max final sharp plays to return' },
          scanLimit: { type: 'number', description: 'Per league/market ranked rows to scan before final filtering' },
          strict: { type: 'boolean', description: 'Default true. When true returns only Bet candidates' },
          includePasses: { type: 'boolean', description: 'Include failed rows with passReasons for dashboard debugging' },
          allowRecentOnly: { type: 'boolean', description: 'Allow recent_supportive_only movement as support' },
          minConsensusBookCount: { type: 'number', description: 'Minimum same-side comparison book count, default 2' },
          minOdds: { type: 'number', description: 'Minimum target-book American odds' },
          maxOdds: { type: 'number', description: 'Maximum target-book American odds' },
          maxAgeMs: { type: 'number', description: 'Treat rows older than this many milliseconds as stale' },
          lookbackHours: {
            type: 'number',
            description: `Odds-history lookback window in hours, default ${DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS}`
          },
          debug: {
            type: 'boolean',
            description: 'Include verbose movement debug payloads in ranked source rows, default true'
          },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          requireIndependentSharpMovement: {
            type: 'boolean',
            description: 'When true (default), only non-target sharp-book movement counts as support'
          },
          requirePlayablePrice: {
            type: 'boolean',
            description: 'When true (default for props), target book must have a playable or best price'
          },
          requireBestPrice: {
            type: 'boolean',
            description: 'When true, target book must have the best price. Default false.'
          },
          minMarketBookCount: {
            type: 'number',
            description: 'Minimum books posting the market for prop classification, default 2'
          },
          minSupportBookCount: {
            type: 'number',
            description: 'Minimum books supporting the same side for prop classification, default 1'
          }
        },
        anyOf: [{ required: ['book'] }, { required: ['targetBook'] }, { required: ['targetBooks'] }, { required: ['targetBooksCsv'] }],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_consensus',
      description:
        'Analyze line history across multiple time windows (1h, 2h, 6h, 12h, 24h, 48h) to detect sustained sharp book consensus movement. Returns plays ranked by how many windows show ALL sharp books moving supportive.',
      inputSchema: {
        type: 'object',
        properties: {
          league: { type: 'string', description: 'League such as Tennis, NBA, MLB' },
          market: { type: 'string', description: 'Market filter, default Moneyline' },
          windows: {
            type: 'array',
            items: { type: 'number' },
            description: 'Time windows in hours to segment history, default [1, 2, 6, 12, 24, 48]'
          },
          sharpBooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sharp books for consensus, default [Pinnacle, BetOnline, BookMaker]'
          },
          minConsensusWindows: {
            type: 'number',
            description: 'Minimum consensus windows required to include a play, default 0 (show all)'
          },
          lookbackHours: { type: 'number', description: 'Total lookback for API query, default 48' },
          limit: { type: 'number', description: 'Max rows to fetch before analysis, default 100' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'all_slates',
      description:
        'Query multiple active leagues at once and return a consolidated ranked list. Best for daily discovery: one call instead of 5-6 separate league screens.',
      inputSchema: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Market filter applied across all leagues, default Moneyline' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific leagues to query. Default: [NBA, MLB, NHL, Tennis, WNBA, Soccer, UFC]'
          },
          limit: { type: 'number', description: 'Max ranked rows per league (default 15)' },
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          lookbackHours: { type: 'number', description: 'Odds-history lookback window in hours, default 6' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'ufc_card',
      description:
        'Query a UFC card and return a first-class shortlist response with official plays, best looks, passes, and summary metadata. Absolves the old query_ufc_screen (which was just a league-specific shortcut).',
      inputSchema: {
        type: 'object',
        properties: {
          book: { type: 'string', description: 'Primary execution book for the UFC card query' },
          targetBook: { type: 'string', description: 'Alias for book' },
          market: { type: 'string', description: 'Primary UFC market filter' },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional UFC market bundle, with the first value used for ranked scanning'
          },
          eventDate: { type: 'string', description: 'Restrict the shortlist to a specific card event date' },
          cardWindow: { type: 'string', description: 'Card window filter such as today, next, or all' },
          upcomingOnly: { type: 'boolean', description: 'Restrict results to upcoming UFC fights only' },
          maxHoursAway: { type: 'number', description: 'Maximum hours until start' },
          strict: { type: 'boolean', description: 'Whether to return only bet candidates from the shortlist' },
          includePasses: { type: 'boolean', description: 'Include pass rows in the shortlist response' },
          limit: { type: 'number', description: 'Max shortlist rows to return per bucket' },
          scanLimit: { type: 'number', description: 'Per league/market ranked rows to scan before shortlisting' },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'recommended_bets',
      description:
        'Return only the highest-confidence plays (TIER 1 — Lock and TIER 2 — Value) across requested leagues, ranked by confidence. Each row includes movementGrade, riskScore (1-10), kaiCall (BET/CONSIDER/PASS), confidenceTier (TIER 1-4), and a human-readable rationale string. Use this as your main "what to bet today" tool.',
      inputSchema: {
        type: 'object',
        properties: {
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'League names to scan, e.g. ["NBA","MLB","NHL","Tennis","WNBA"]. Defaults to all supported leagues.'
          },
          market: { type: 'string', description: 'Market type, default "Moneyline"' },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter, e.g. ["NoVigApp","Pinnacle"]'
          },
          targetTiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tier filter, e.g. ["TIER 1"] to get only locks, or ["TIER 1","TIER 2"] for all recommendations. Defaults to ["TIER 1","TIER 2"].'
          },
          limit: { type: 'number', description: 'Max plays to return per league, default 10' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'staking_plan',
      description:
        'Given a bankroll and optional play filter, return stake allocations across recommended bets. Uses fractional Kelly staking: TIER 1 = 2%, TIER 2 = 1% of bankroll. Includes total exposure, per-play stake dollars, and correlation warnings.',
      inputSchema: {
        type: 'object',
        properties: {
          bankroll: { type: 'number', description: 'Total bankroll in dollars, default 1000' },
          leagues: { type: 'array', items: { type: 'string' }, description: 'League filter, e.g. ["NBA","MLB"]. Defaults to all supported leagues.' },
          market: { type: 'string', description: 'Market type, default "Moneyline"' },
          targetTiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tier filter, defaults to ["TIER 1","TIER 2"]'
          },
          limit: { type: 'number', description: 'Max plays per league, default 10' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'clv_history',
      description:
        'Read your bet log CSV and compute your actual CLV track record over a lookback window. Returns average CLV%, CLV stddev, win rate, profit, ROI, plus per-group breakdowns (by week, sport, tier, or book).',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Lookback window in days, default 30' },
          groupBy: { type: 'string', description: 'One of: week, sport, tier, book. Default week.' },
          path: {
            type: 'string',
            description: 'Override bet log CSV path. Default: ~/Documents/bet-log.csv or BET_LOG_PATH env var.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'player_context',
      description:
        'Get recent news, tweets, and a computed risk flag for a player. Returns up to 30 recent tweets mentioning the player from X plus a Google News RSS layer (with ESPN as tertiary fallback). Each item is scored 0-100 for source authority. USE THIS BEFORE PLACING A BET: if riskFlag === "high", downgrade or skip the play.',
      inputSchema: {
        type: 'object',
        properties: {
          player: { type: 'string', description: 'Player full name (e.g., "Frances Tiafoe")' },
          sport: { type: 'string', description: 'Sport name (e.g., "Tennis", "NBA", "MLB")' },
          gameTime: { type: 'string', description: 'Optional ISO timestamp of the game' },
          maxAgeMinutes: { type: 'number', description: 'How far back to search, default 60' },
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
      name: 'league_presets',
      description:
        'Return the current sport-specific ranking presets used by screen ranking. Shows which leagues are considered sharp, which books are the comparison set for main markets and player props, and the research context.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'health_status',
      description:
        'Check auth freshness and confirm the PropProfessor screen endpoint responds. Use this to verify connectivity before running a report.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'get_hidden_bets',
      description: 'List all currently hidden bets. Useful for checking what is suppressed from the /fantasy table.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'hide_bet',
      description:
        'Hide a bet from the /fantasy table to suppress duplicate rows. Provide the bet object with fields like betId, matchId, market, and selection.',
      inputSchema: {
        type: 'object',
        properties: {
          bet: { type: 'object', description: 'Bet object to hide. Typically includes betId, matchId, market, selection, and optional date metadata.' }
        },
        required: ['bet'],
        additionalProperties: false
      }
    },
    {
      name: 'unhide_bet',
      description: 'Unhide a previously hidden bet by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The hidden bet ID to restore visibility for.' }
        },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'clear_hidden_bets',
      description: 'Clear all hidden bets at once. Restores visibility to everything previously suppressed.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'find_best_price',
      description:
        'Find the best available price across all books for a specific play. Line shopping tool: shows every book\'s odds sorted best to worst with spread from best price.',
      inputSchema: {
        type: 'object',
        properties: {
          league: { type: 'string', description: 'League such as NBA, MLB, NHL, Tennis' },
          market: { type: 'string', description: 'Market type, e.g. Moneyline, Spread, Total' },
          game: { type: 'string', description: 'Game matchup or team name to match' },
          selection: { type: 'string', description: 'Player or team selection to match' },
          books: { type: 'array', items: { type: 'string' }, description: 'Optional book filter - show only these books' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league', 'market', 'game', 'selection'],
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildToolDefinitions };
