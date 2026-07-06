'use strict';

const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('../propprofessor-mcp-ranked-screen');

const HONEST_SCOPE_CAVEAT =
  ' tier/kaiCall/edge/screenScore are signal-quality ratings, not win-probability predictions.';

const VERBOSITY_PARAM = {
  type: 'string',
  enum: ['minimal', 'standard', 'full'],
  description:
    'Output detail level. minimal: returns {summary: string, count: number, type: "plays"|"no_plays"} — a plain-English summary wrapped in a parseable JSON envelope. standard: structured rows with edge/tier/risk + brief rationale. full: all movement data, line history, debug payloads. Default: standard.'
};

/**
 * Filter the response by signal-quality tier (BET | CONSIDER | PASS).
 * Use `kaiCall: ["BET"]` to get only strong plays. Default: no filter
 * (return all rows). Missing/garbage kaiCall values are treated as PASS.
 */
const KAI_CALL_FILTER_PARAM = {
  type: 'array',
  items: { type: 'string', enum: ['BET', 'CONSIDER', 'PASS'] },
  description:
    'Optional filter by display tier (BET | CONSIDER | PASS). Default: no filter. Example: ["BET"] for "bets only" or ["BET", "CONSIDER"] to drop PASS rows. Missing/garbage kaiCall is treated as PASS.'
};

/**
 * Sort the response by a single field. Each field has a sensible default
 * direction; override with sortDir. Missing-field rows always land at the
 * end regardless of direction.
 */
const SORT_BY_PARAM = {
  type: 'string',
  enum: ['start', 'edge', 'tier', 'consensusBookCount', 'riskScore'],
  description:
    'Optional sort key. start = game time ascending (soonest first). edge = consensus edge descending (largest first). tier = TIER 1 first. consensusBookCount = most books first. riskScore = lowest risk first. Default: server-defined order (tier then edge). Missing-field rows always go to the end.'
};

const SORT_DIR_PARAM = {
  type: 'string',
  enum: ['asc', 'desc'],
  description: 'Optional sort direction. Overrides the per-field default. asc = ascending, desc = descending.'
};

const MIN_EV_PARAM = {
  type: 'number',
  description:
    'Optional minimum consensus edge percentage. Filters to +EV plays only (e.g. minEV=1.0 keeps plays with 1%+ edge). Default: no filter.'
};

/** @returns {import('./types').ToolDefinition[]} */
function buildScreenTools() {
  return [
    {
      name: 'quick_screen',
      description:
        'One-call sharp-play scanner: target a book, scan all leagues × markets, get ranked results with player-context research and risk flags. Defaults to NoVigApp.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with books=["Fliff"].',
        properties: {
          books: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Target execution books, e.g. ["Fliff", "NovigApp"]. Defaults to ["NoVigApp"]. Use a single book for focused results or multiple books for comparisons.'
          },
          book: { type: 'string', description: 'Single target book shortcut (alias for books: ["BookName"])' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Leagues to scan, e.g. ["MLB", "NBA"]. Defaults to every league the PropProfessor backend supports: NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC.'
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
          targetTiers: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Tier filter, e.g. ["TIER 1"] to get only locks, or ["TIER 1", "TIER 2"] for recommendations. Defaults to no filter (return all tiers).'
          },

          includeResearch: {
            type: 'boolean',
            description: 'Run player_context research on each bet candidate. Default true.'
          },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads, default false' },
          verbosity: VERBOSITY_PARAM,
          validateTop: {
            type: 'integer',
            minimum: 0,
            maximum: 10,
            default: 0,
            description:
              'When > 0, runs validate_play on the top N candidates per league/market before returning, merging verdictSummary and gameContext data into each row. Defaults to 0 (off) — the condensed scan already returns tiers, movement disposition, and research. Set to 3+ when you want deep validation with re-fetched consensus counts.'
          },
          kaiCall: KAI_CALL_FILTER_PARAM,
          minEV: MIN_EV_PARAM,
          sortBy: SORT_BY_PARAM,
          sortDir: SORT_DIR_PARAM,
        },
        additionalProperties: false
      }
    },
    {
      name: 'screen_ranked',
      description:
        'Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata. Auto-resolves league-specific market names.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with league="NBA", market="Moneyline".',
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
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default false'
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
          includeResearch: {
            type: 'boolean',
            description:
              'When true, run player_context research on each recommended play and attach riskFlag, riskSummary, and topTweet to the result. Use this to validate plays before placing a bet. Default false. Caches aggressively in player_context (30-min TTL, 5-min for high-risk).'
          },
          riskDowngrade: {
            type: 'boolean',
            description:
              'When true AND includeResearch=true, plays with riskFlag="high" are removed from the recommendation. Without this, risk flags are just annotations and the plays stay. Default false.'
          },
          playableOnly: {
            type: 'boolean',
            description:
              'When true, keep rows where the user-requested book is within the normal market range (executionQuality != "bad") even when consensusEdge is negative or zero. Use this when you want to find plays on a specific book (e.g. Fliff) at executable prices, not just positive-EV opportunities. Rows where the requested book is wildly off-market are still dropped. Default false.'
          },
          include: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of top-level response sections to include. Values: "freshness", "warnings", "resultMeta", "league". Example: ["resultMeta"] to get only ok+result+resultMeta. Default: all sections.'
          },
          verbosity: VERBOSITY_PARAM,
          kaiCall: KAI_CALL_FILTER_PARAM,
          minEV: MIN_EV_PARAM,
          sortBy: SORT_BY_PARAM,
          sortDir: SORT_DIR_PARAM,
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_plays',
      description:
        'Scanner for the best target-book plays with supportive sharp movement across leagues and markets. Each row includes consensusStrength.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with targetBooks=["Fliff"], leagues=["NBA","MLB"].',
        properties: {
          targetBooks: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Target execution books to scan together, such as ["Fliff", "NoVigApp"]. CANONICAL name for the books param — prefer this over all aliases below.'
          },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Alias for targetBooks. Use either books or targetBooks — both work.'
          },
          targetBooksCsv: {
            type: 'string',
            description:
              'Comma-separated books for dashboard URLs (e.g. "Fliff,NoVigApp"). Deprecated alias — prefer the canonical "targetBooks" array. Still accepted.'
          },
          book: {
            type: 'string',
            description:
              'Legacy single target execution book such as Fliff, NoVigApp, or Rebet. Deprecated alias — prefer "targetBooks" array. Still accepted.'
          },
          targetBook: {
            type: 'string',
            description: 'Legacy alias for book. Deprecated — prefer "targetBooks" array. Still accepted.'
          },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Leagues to scan. Defaults to every league the PropProfessor backend supports: NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC.'
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
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads, default false' },
          verbosity: VERBOSITY_PARAM,
          kaiCall: KAI_CALL_FILTER_PARAM,
          minEV: MIN_EV_PARAM,
          sortBy: SORT_BY_PARAM,
          sortDir: SORT_DIR_PARAM,
        },
        additionalProperties: false
      }
    },
    {
      name: 'recommended_bets',
      description:
        'Return only the highest-quality movement signals across requested leagues, ranked by signal strength. Each row includes tier, riskScore, kaiCall, and rationale.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with no args.',
        properties: {
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter, e.g. ["NoVigApp", "Pinnacle"]'
          },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description:
              'League names to scan, e.g. ["NBA", "MLB"]. Defaults to every league the PropProfessor backend supports: NBA, MLB, NFL, NHL, WNBA, NCAAB, NCAAF, Soccer, Tennis, UFC.'
          },
          limit: { type: 'number', description: 'Max plays to return per league, default 10' },
          market: {
            type: 'string',
            description:
              'Market type, default "Moneyline". Deprecated — prefer the canonical "markets" (plural array) param for multi-market scans. Still accepted for backward compatibility; the handler maps a single market to a one-element array internally.'
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
          verbosity: VERBOSITY_PARAM,
          validateTop: {
            type: 'integer',
            minimum: 0,
            maximum: 10,
            default: 0,
            description:
              'When > 0, runs validate_play on the top N plays per league before returning, merging verdictSummary and gameContext data into each row. Eliminates the need for a separate validate_play call.'
          },
          kaiCall: KAI_CALL_FILTER_PARAM,
          minEV: MIN_EV_PARAM,
          sortBy: SORT_BY_PARAM,
          sortDir: SORT_DIR_PARAM,
        },
        additionalProperties: false
      }
    },
    {
      name: 'smart_bet',
      description:
        'One-call bet evaluation: given a player/team and book, returns play details, validation verdict, best price across books, and staking recommendation.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with selection="Tatum", book="Fliff", league="NBA".',
        properties: {
          selection: { type: 'string', description: 'Player or team name. Required.' },
          book: { type: 'string', description: 'Target execution book (e.g. "Fliff", "NoVigApp"). Required.' },
          league: { type: 'string', description: 'League (e.g. "NBA", "MLB"). Helps narrow the search.' },
          market: { type: 'string', description: 'Market type, default "Moneyline".' },
          bankroll: { type: 'number', description: 'Bankroll in dollars for staking recommendation. Default 1000.' },
          verbosity: VERBOSITY_PARAM
        },
        required: ['selection', 'book'],
        additionalProperties: false
      }
    },
    {
      name: 'staking_plan',
      description:
        'Given a bankroll, return stake allocations across recommended bets using fractional Kelly staking (TIER 1 = 2%, TIER 2 = 1% of bankroll).' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with bankroll=1000.',
        properties: {
          bankroll: { type: 'number', description: 'Total bankroll in dollars, default 1000' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'League filter, e.g. ["NBA", "MLB"]. Defaults to all supported leagues.'
          },
          limit: { type: 'number', description: 'Max plays per league, default 10' },
          market: {
            type: 'string',
            description:
              'Market type, default "Moneyline". Deprecated — prefer the canonical "markets" (plural array) param for multi-market scans. Still accepted for backward compatibility; the handler maps a single market to a one-element array internally.'
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
      name: 'ufc_card',
      description:
        'Query a UFC card and return a shortlist with official plays, best looks, passes, and summary metadata.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with book="NoVigApp", market="Moneyline".',
        properties: {
          book: { type: 'string', description: 'Primary execution book for the UFC card query' },
          cardWindow: { type: 'string', description: 'Card window filter such as today, next, or all' },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads' },
          eventDate: { type: 'string', description: 'Restrict the shortlist to a specific card event date' },
          includePasses: { type: 'boolean', description: 'Include pass rows in the shortlist response' },
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
      name: 'tonight_bets',
      description:
        'One-call bundle: screen + sort by game time + filter to BET/CONSIDER tier. Returns validated, executable plays for a specific book. Use when you want actionable bets for tonight without chaining multiple calls.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with book="Fliff" to get tonight\'s best plays on Fliff.',
        properties: {
          book: { type: 'string', description: 'Target book (e.g. "Fliff", "NoVigApp"). Required.' },
          leagues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional league filter, e.g. ["NBA", "MLB"]. Defaults to all leagues.'
          },
          league: { type: 'string', description: 'Single league shortcut' },
          limit: { type: 'number', description: 'Max plays to return, default 5' },
          verbosity: VERBOSITY_PARAM
        },
        required: ['book'],
        additionalProperties: false
      }
    }
  ];
}

module.exports = { buildScreenTools, VERBOSITY_PARAM };
