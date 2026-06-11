'use strict';

const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('./propprofessor-mcp-ranked-screen');

/**
 * Build the full array of MCP tool definition objects for all ProppProfessor tools.
 * Each tool definition includes a name, description, and input JSON Schema.
 * Tools are sorted alphabetically by name before being returned.
 *
 * @returns {Array<Object>} An array of tool definition objects, each containing:
 *   - name {string} — The MCP tool name
 *   - description {string} — Human-readable tool description
 *   - inputSchema {Object} — JSON Schema object describing the tool's input parameters with
 *       type, properties, required fields, and additionalProperties settings
 */
function buildToolDefinitions() {
  const VERBOSITY_PARAM = {
    type: 'string',
    enum: ['minimal', 'standard', 'full'],
    description:
      'Output detail level. minimal: plain English summary for casual bettors. standard: edge/tier/risk with brief rationale. full: all movement data, line history, debug payloads. Default: standard.'
  };

  return [
    {
      name: 'ev_candidates',
      description:
        'Query the sportsbook +EV endpoint and return candidate plays for enabled books. Secondary discovery only — use /screen for primary playable-bet selection. Set validated=true to run sharp-movement validation on candidates. Returns 0 rows on quiet days when no +EV opportunities exist — that is normal, not a bug.',
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
            description:
              'Required league filter, e.g. NBA, MLB, NHL, Tennis, UFC, Soccer. Omitting this will cause a backend 400 error.'
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
          },
          verbosity: VERBOSITY_PARAM
        },
        required: ['leagues'],
        additionalProperties: false
      }
    },
    {
      name: 'screen_raw',
      description:
        'Query the live Odds Screen payload from /screen with the current league, market, game, and participant filters. Set bestComps=true to use the sharper default comparison book set (Pinnacle, Polymarket, Kalshi, BetOnline, Circa). Generic market names like Total or Spread are auto-resolved per league — e.g. NHL Total becomes Total Goals, MLB Spread becomes Run Line.',
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
            description:
              'Use sharper default comparison book set (Pinnacle, Polymarket, Kalshi, BetOnline, Circa). Default false.'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'screen_ranked',
      description:
        "Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata for any market. This is the primary tool for getting tiered, ranked plays. Generic market names like Total or Spread are auto-resolved per league — e.g. NHL Total becomes Total Goals, MLB Spread becomes Run Line. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Set compact=true to strip verbose payloads and return only essential fields per match — reduces response size by ~90%. NOTE: When you pass a single non-sharp book (e.g. NoVigApp), the tool auto-augments the query with the league's sharp book set (Pinnacle, BetOnline, Circa, etc.) so consensus and movement data populate.",
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
          historySportsbooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional sportsbooks to fetch odds history for (overrides books for history enrichment only)'
          },
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
          verbosity: VERBOSITY_PARAM
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'screen',
      description:
        "Query /screen for any supported league and return league-specific ranked rows. Replaces all per-league screen tools (query_nba_screen, query_mlb_screen, etc.). Use this as the default league screen tool. Generic market names like Total or Spread are auto-resolved per league — e.g. NHL Total becomes Total Goals, MLB Spread becomes Run Line. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. NOTE: When you pass a single non-sharp book (e.g. NoVigApp), the tool auto-augments the query with the league's sharp book set (Pinnacle, BetOnline, Circa, etc.) so consensus and movement data populate.",
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
          book: {
            type: 'string',
            description: 'Tennis only: preferred book to rank, default Pinnacle. Ignored for other leagues.'
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
          verbosity: VERBOSITY_PARAM
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_plays',
      description:
        'Add-on scanner for the best target-book plays with supportive sharp movement. Queries /screen across leagues/markets, hydrates odds history, and only treats non-target sharp-book movement as support. Generic market names are auto-resolved per league (e.g. NHL Total → Total Goals, MLB Spread → Run Line). Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override.',
      inputSchema: {
        type: 'object',
        properties: {
          targetBooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Target execution books to scan together, such as ["Fliff", "NoVigApp"]'
          },
          targetBooksCsv: { type: 'string', description: 'Comma-separated alias for targetBooks, for dashboard URLs' },
          book: {
            type: 'string',
            description: 'Legacy single target execution book such as Fliff, NoVigApp, or Rebet'
          },
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
            description: 'Markets to scan, default ["Moneyline", "Spread", "Total"]. Overrides `market` if provided.'
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
          includePasses: {
            type: 'boolean',
            description: 'Include failed rows with passReasons for dashboard debugging'
          },
          allowRecentOnly: { type: 'boolean', description: 'Allow recent_supportive_only movement as support' },
          requireIndependentSharpMovement: {
            type: 'boolean',
            description: 'Require non-target sharp support when true'
          },
          requireBestPrice: { type: 'boolean', description: 'Require target book to have the best available price' },
          minMarketBookCount: { type: 'number', description: 'Minimum market book count for prop classification' },
          minSupportBookCount: { type: 'number', description: 'Minimum support book count for prop classification' },
          maxOdds: { type: 'number', description: 'Maximum target-book American odds' },
          minOdds: { type: 'number', description: 'Minimum target-book American odds' },
          lookbackHours: { type: 'number', description: 'Odds-history lookback window in hours' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads, default true' },
          verbosity: VERBOSITY_PARAM
        },
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
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
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
        'Query multiple active leagues at once and return a consolidated ranked list. Best for daily discovery: one call instead of 5-6 separate league screens. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set.',
      inputSchema: {
        type: 'object',
        properties: {
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific leagues to query. Default: [NBA, MLB, NHL, Tennis, WNBA, Soccer, UFC]'
          },
          limit: { type: 'number', description: 'Max ranked rows per league (default 15)' },
          lookbackHours: { type: 'number', description: 'Odds-history lookback window in hours, default 6' },
          market: {
            type: 'string',
            description:
              'Market filter applied across all leagues, default Moneyline. Deprecated: use `markets` for multi-market scans.'
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
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'ufc_card',
      description:
        'Query a UFC card and return a first-class shortlist response with official plays, best looks, passes, and summary metadata. Absolves the old per-league UFC shortcut.',
      inputSchema: {
        type: 'object',
        properties: {
          book: { type: 'string', description: 'Primary execution book for the UFC card query' },
          cardWindow: { type: 'string', description: 'Card window filter such as today, next, or all' },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads' },
          eventDate: { type: 'string', description: 'Restrict the shortlist to a specific card event date' },
          includePasses: { type: 'boolean', description: 'Include pass rows in the shortlist response' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          limit: { type: 'number', description: 'Max shortlist rows to return per bucket' },
          market: { type: 'string', description: 'Primary UFC market filter' },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional UFC market bundle, with the first value used for ranked scanning'
          },
          maxHoursAway: { type: 'number', description: 'Maximum hours until start' },
          scanLimit: { type: 'number', description: 'Per league/market ranked rows to scan before shortlisting' },
          strict: { type: 'boolean', description: 'Whether to return only bet candidates from the shortlist' },
          targetBook: { type: 'string', description: 'Alias for book' },
          upcomingOnly: { type: 'boolean', description: 'Restrict results to upcoming UFC fights only' },
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'recommended_bets',
      description:
        'Return only the highest-confidence plays across requested leagues, ranked by confidence. Each row includes movementGrade, riskScore (1-10), kaiCall (BET/CONSIDER/PASS), confidenceTier (TIER 1-4), consensusStrength (strong/moderate/weak/none), and a human-readable rationale string. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. When aliases are resolved, `responseMeta.markets_alias_used` is set. Use this as your main what-to-bet-today tool. Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override.',
      inputSchema: {
        type: 'object',
        properties: {
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter, e.g. ["NoVigApp", "Pinnacle"]'
          },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'League names to scan, e.g. ["NBA", "MLB", "NHL", "Tennis", "WNBA"]. Defaults to all supported leagues.'
          },
          limit: { type: 'number', description: 'Max plays to return per league, default 10' },
          market: {
            type: 'string',
            description: 'Market type, default "Moneyline". Deprecated: use `markets` for multi-market scans.'
          },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Market types to scan. Default: ["Moneyline", "Spread", "Total"]. Overrides `market` if provided.'
          },
          targetTiers: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Tier filter, e.g. ["TIER 1"] to get only locks, or ["TIER 1", "TIER 2"] for all recommendations. Defaults to ["TIER 1", "TIER 2"].'
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
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'staking_plan',
      description:
        'Given a bankroll and optional play filter, return stake allocations across recommended bets. Uses fractional Kelly staking: TIER 1 = 2%, TIER 2 = 1% of bankroll. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Each play includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Includes total exposure, per-play stake dollars, and correlation warnings. Defaults to scanning Moneyline, Spread, and Total markets via `recommended_bets`.',
      inputSchema: {
        type: 'object',
        properties: {
          bankroll: { type: 'number', description: 'Total bankroll in dollars, default 1000' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'League filter, e.g. ["NBA", "MLB"]. Defaults to all supported leagues.'
          },
          limit: { type: 'number', description: 'Max plays per league, default 10' },
          market: {
            type: 'string',
            description: 'Market type, default "Moneyline". Deprecated: use `markets` for multi-market scans.'
          },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Market types to scan. Default: ["Moneyline", "Spread", "Total"]. Overrides `market` if provided.'
          },
          targetTiers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tier filter, defaults to ["TIER 1", "TIER 2"]'
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
          verbosity: VERBOSITY_PARAM
        },
        required: ['bankroll'],
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
      name: 'get_play_details',
      description:
        'Get full details (including line history, consensus, movement debug) for specific plays by game ID. Generic market names are auto-resolved per league. Each row includes `consensusStrength` (strong/moderate/weak/none). Use after a compact/fields screen query to drill into selected plays. Returns full rows with all metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          league: {
            type: 'string',
            description: 'League such as NBA, Tennis, MLB. Required.'
          },
          game_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Game IDs to fetch full details for. These are the gameId values from screen rows.'
          },
          market: {
            type: 'string',
            description: 'Market type, default Moneyline'
          },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter'
          },
          lookbackHours: {
            type: 'number',
            description: 'Odds-history lookback window in hours, default 6'
          }
        },
        required: ['league', 'game_ids'],
        additionalProperties: false
      }
    },
    {
      name: 'league_presets',
      description: 'Show the current sport-specific ranking presets.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'health_status',
      description:
        'Check auth freshness and endpoint connectivity. Reports token persistence state: `persistedToDisk` (boolean), `refreshCount` (number of refreshes since startup), and `lastRefreshed` (ISO timestamp).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'get_hidden_bets',
      description: 'List all currently hidden bets. Useful for checking what is suppressed from the /fantasy table.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'hide_bet',
      description: 'Hide a bet from the /fantasy table to suppress duplicate rows.',
      inputSchema: {
        type: 'object',
        properties: {
          bet: {
            type: 'object',
            description:
              'Bet object to hide. Typically includes betId, matchId, market, selection, and optional date metadata.'
          }
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
      name: 'novig_screen',
      description:
        'NoVigApp-specific screen: find the best playable bets on NoVigApp. Queries NoVigApp prices with sharp consensus data, checks for supportive odds history movement at sharp books, and runs player context research on top candidates. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. NoVigApp price does not need to be the best — just playable (not "bad" execution quality). Returns ranked Bet candidates with player risk flags.',
      inputSchema: {
        type: 'object',
        properties: {
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Leagues to scan, e.g. ["MLB", "NBA"]. Defaults to all supported leagues.'
          },
          league: { type: 'string', description: 'Single league shortcut' },
          markets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Markets to scan, default ["Moneyline", "Spread", "Total"]. Overrides `market` if provided.'
          },
          market: { type: 'string', description: 'Single market shortcut, default "Moneyline"' },
          limit: { type: 'number', description: 'Max bet candidates to return per league, default 10' },
          scanLimit: { type: 'number', description: 'Rows to scan per league/market before filtering, default 50' },
          lookbackHours: { type: 'number', description: 'Odds-history lookback window in hours, default 6' },
          is_live: { type: 'boolean', description: 'Whether to query live odds' },
          includeResearch: {
            type: 'boolean',
            description: 'Run player_context research on each bet candidate. Default true.'
          },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads, default false' },
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'clear_hidden_bets',
      description: 'Clear all hidden bets at once. Restores visibility to everything previously suppressed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'clear_score_timeline',
      description:
        'Clear the score timeline cache used for tier trajectory tracking. Resets all historical tier data. Use when starting a new session or after config changes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'find_best_price',
      description:
        "Line shopping: show every book's odds sorted best to worst with spread from best price. Generic market names like Total or Spread are auto-resolved per league — e.g. NHL Total becomes Total Goals, MLB Spread becomes Run Line.",
      inputSchema: {
        type: 'object',
        properties: {
          game: { type: 'string', description: 'Game matchup or team name to match' },
          league: { type: 'string', description: 'League such as NBA' },
          market: { type: 'string', description: 'Market type, e.g. Moneyline, Spread, Total' },
          selection: { type: 'string', description: 'Player or team selection to match' },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter - show only these books'
          },
          is_live: { type: 'boolean', description: 'Whether to query live odds' }
        },
        required: ['league', 'market', 'game', 'selection'],
        additionalProperties: false
      }
    },
    {
      name: 'get_started',
      description:
        'Get recommended workflow based on user type. Call this first to understand which tools to use for casual, intermediate, or sharp bettors.',
      inputSchema: {
        type: 'object',
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
      name: 'log_pick',
      description:
        'Log a bet you placed before tip-off. Records game, league, market, selection, odds, stake, and optional metadata. Use this to track your personal betting performance and compare against the system recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          game: { type: 'string', description: 'Game matchup (e.g. "Lakers vs Celtics")' },
          league: { type: 'string', description: 'League (e.g. NBA, MLB, NHL)' },
          market: { type: 'string', description: 'Market type (e.g. Moneyline, Spread, Total)' },
          selection: { type: 'string', description: 'Team or player you bet on' },
          odds: { type: 'number', description: 'American odds (e.g. -110, +150)' },
          stake: { type: 'number', description: 'Optional stake amount in dollars' },
          confidenceTier: {
            type: 'string',
            description: 'Optional confidence tier from recommended_bets or novig_screen'
          },
          kaiCall: { type: 'string', description: 'Optional Kai call from the analysis (BET/CONSIDER/PASS)' },
          rationale: { type: 'string', description: 'Optional rationale for the pick' },
          notes: { type: 'string', description: 'Optional personal notes' }
        },
        required: ['game', 'league', 'market', 'selection', 'odds'],
        additionalProperties: false
      }
    },
    {
      name: 'get_pick_history',
      description:
        'View your logged betting history. Filter by status (pending/won/lost/push/all), league, recency, and limit. Returns most recent first.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'won', 'lost', 'push', 'all'],
            description: 'Filter by result status. Default: all.'
          },
          league: { type: 'string', description: 'Filter by league name' },
          days: { type: 'number', description: 'Only picks from the last N days' },
          limit: { type: 'number', description: 'Max picks to return (default 50)' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'resolve_pick',
      description:
        'Mark a logged pick as won, lost, or push after the game ends. Updates your personal betting record for accurate stats.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The pick UUID from log_pick or get_pick_history' },
          result: { type: 'string', enum: ['won', 'lost', 'push'], description: 'Actual outcome of the bet' }
        },
        required: ['id', 'result'],
        additionalProperties: false
      }
    },
    {
      name: 'get_pick_stats',
      description:
        'Get your personal betting performance stats: win rate, profit/loss, breakdowns by league and confidence tier. Helps you see what strategies are working.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Only include picks from the last N days' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'get_alerts',
      description:
        'Check for new sharp line movements, steam moves, and significant odds changes since you last checked. Uses the multi-window sharp consensus engine to detect fresh movement signals across all requested leagues.',
      inputSchema: {
        type: 'object',
        properties: {
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Leagues to check for alerts. Default: NBA, MLB, NHL, Tennis, WNBA.'
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
    }
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

module.exports = { buildToolDefinitions };
