'use strict';

const { DEFAULT_ODDS_HISTORY_LOOKBACK_HOURS } = require('./propprofessor-mcp-ranked-screen');

/**
 * Group every tool by what an agent uses it for. Categories are surfaced
 * as a `category` field on each tool definition and are also the basis
 * for lite-mode filtering (see LITE_MODE_TOOLS below).
 *
 *   discovery   — find plays (scout, multi-league scans, DFS, +EV)
 *   screen      — score/rank plays for a target book (the "main work")
 *   drill_down  — deep dive on a specific play (validate, line shop, raw detail)
 *   research    — context data (player news, game weather, alerts)
 *   tracking    — personal bet log (log, history, stats, resolve)
 *   admin       — bookkeeping (hidden bets, score timeline cache)
 *   meta        — server info / workflow guides (health, presets, get_started)
 */
const TOOL_CATEGORIES = {
  all_slates: 'discovery',
  ask: 'discovery',
  ev_candidates: 'discovery',
  fantasy_optimizer: 'discovery',
  sharp_consensus: 'discovery',
  get_market_registry: 'discovery',
  quick_screen: 'screen',
  recommended_bets: 'screen',
  screen_ranked: 'screen',
  sharp_plays: 'screen',
  staking_plan: 'screen',
  ufc_card: 'screen',
  find_best_price: 'drill_down',
  get_play_details: 'drill_down',
  validate_play: 'drill_down',
  get_alerts: 'research',
  mlb_game_context: 'research',
  player_context: 'research',
  get_pick_history: 'tracking',
  get_pick_stats: 'tracking',
  log_pick: 'tracking',
  resolve_pick: 'tracking',
  clear_score_timeline: 'admin',
  manage_hidden_bets: 'admin',
  get_started: 'meta',
  health_status: 'meta',
  league_presets: 'meta'
};

/**
 * Tools exposed in lite mode. These cover the casual + intermediate
 * agent workflow: discover → drill-down → validate → track. Sharp users
 * can opt back into the full 26-tool surface via PROPPROFESSOR_MCP_MODE=full.
 */
const LITE_MODE_TOOLS = new Set([
  'ask', // natural-language router
  'recommended_bets', // main "what to bet" tool
  'quick_screen', // one-call bundle (sharp_plays + player_context)
  'find_best_price', // line shopping across books
  'validate_play', // pre-bet execution + injury + (MLB) game context
  'get_play_details', // raw detail for a specific gameId
  'player_context', // injury/news risk flag before betting
  'log_pick', // record a placed bet
  'get_pick_history', // review past picks with filters
  'resolve_pick' // mark a pick won/lost/push after the game
]);

/**
 * Build the full array of MCP tool definition objects for all ProppProfessor tools.
 * Each tool definition includes a name, description, and input JSON Schema.
 * Tools are sorted alphabetically by name before being returned.
 *
 * @param {Object} [options] - Build options.
 * @param {('full'|'lite')} [options.mode='full'] - 'full' returns all 26 tools;
 *   'lite' returns only the 10 essentials (router, screen, drill-down,
 *   research, track) for casual/intermediate agents. Set via
 *   PROPPROFESSOR_MCP_MODE env var at server boot.
 * @returns {Array<Object>} An array of tool definition objects, each containing:
 *   - name {string} — The MCP tool name
 *   - description {string} — Human-readable tool description
 *   - category {string} — One of: discovery, screen, drill_down, research,
 *       tracking, admin, meta. Helps agents mentally group the surface.
 *   - inputSchema {Object} — JSON Schema object describing the tool's input parameters with
 *       type, properties, required fields, and additionalProperties settings
 */
function buildToolDefinitions({ mode = 'full' } = {}) {
  // Appended to every tool whose response includes confidenceTier, kaiCall,
  // or screenScore. The TIER 1-4 / BET-CONSIDER-PASS / edge values are
  // signal-quality ratings on what sharp books are doing — NOT predictions
  // about which side will win. TIER 1 hit rate sits around chance on the
  // synthetic backtest. Agents that skip the README and only read tool
  // catalogs must see this caveat inline.
  const HONEST_SCOPE_CAVEAT =
    ' tier/kaiCall/edge/screenScore are signal-quality ratings, not win-probability predictions.';

  const VERBOSITY_PARAM = {
    type: 'string',
    enum: ['minimal', 'standard', 'full'],
    description:
      'Output detail level. minimal: plain-English SUMMARY STRING, not structured JSON — do not parse the response as data. standard: structured rows with edge/tier/risk + brief rationale. full: all movement data, line history, debug payloads. Default: standard.'
  };

  const definitions = [
    {
      name: 'ev_candidates',
      description:
        'Query the sportsbook +EV endpoint and return candidate plays for enabled books. Secondary discovery only — use /screen for primary playable-bet selection. Set validated=true to run sharp-movement validation on candidates. Returns 0 rows on quiet days when no +EV opportunities exist — that is normal, not a bug.' +
        HONEST_SCOPE_CAVEAT,
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
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live +EV rows. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live +EV rows. Canonical name (preferred over "is_live").'
          },
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
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default false'
          },
          verbosity: VERBOSITY_PARAM
        },
        required: ['leagues'],
        additionalProperties: false
      }
    },
    {
      name: 'quick_screen',
      description:
        'The fastest way to find playable bets on ANY book in one call. Specifies a target book (or books), scans all leagues × markets for sharp plays with independent consensus confirmation, runs player context research on candidates, and returns ranked results with risk flags. The target book price does not need to be the best — just playable (not "bad" execution quality). Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Equivalent to sharp_plays + player_context bundled. Use when asked "show me the best plays on [book]" or "what\'s good on Fliff tonight". Defaults to NoVigApp if no book specified.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
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
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
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
      name: 'screen_ranked',
      description:
        "Query /screen and return hydrated ranked rows with consensus, movement, and freshness metadata for any market. This is the primary tool for getting tiered, ranked plays. Generic market names like Total or Spread are auto-resolved per league — e.g. NHL Total becomes Total Goals, MLB Spread becomes Run Line. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Set compact=true to strip verbose payloads and return only essential fields per match — reduces response size by ~90%. NOTE: When you pass a single non-sharp book (e.g. NoVigApp), the tool auto-augments the query with the league's sharp book set (Pinnacle, BetOnline, Circa, etc.) so consensus and movement data populate. RELATED: `recommended_bets` returns a TIER 1-4 filtered subset; `quick_screen` bundles screen_ranked + player_context in one call; `sharp_plays` enforces stricter movement-confirmation rules." +
        HONEST_SCOPE_CAVEAT,
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
              'Include verbose movement debug payloads such as filtered line history and dropped-point reasons, default false'
          },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
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
          verbosity: VERBOSITY_PARAM
        },
        required: ['league'],
        additionalProperties: false
      }
    },
    {
      name: 'sharp_plays',
      description:
        'Add-on scanner for the best target-book plays with supportive sharp movement. Queries /screen across leagues/markets, hydrates odds history, and only treats non-target sharp-book movement as support. Generic market names are auto-resolved per league (e.g. NHL Total → Total Goals, MLB Spread → Run Line). Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override. RELATED: `quick_screen` is the one-call bundle (sharp_plays + player_context + risk flag); `recommended_bets` returns TIER 1-4 filtered plays without target-book constraints; `sharp_consensus` returns the multi-window movement evidence underneath the ranking.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
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
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads, default false' },
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'sharp_consensus',
      description:
        'Analyze line history across multiple time windows (1h, 2h, 6h, 12h, 24h, 48h) to detect sustained sharp book consensus movement. Returns plays ranked by how many windows show ALL sharp books moving supportive. Use when you want to understand WHY a play ranks, not just WHAT ranks — `recommended_bets` and `quick_screen` give you ranked plays faster; `sharp_consensus` gives you the multi-window movement evidence underneath the ranking. Returns all ranked rows by sustained agreement, including rows that did not survive the strict filter on sibling tools.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        properties: {
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
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
        'Query multiple active leagues at once and return a consolidated ranked list. Best for daily discovery: one call instead of 5-6 separate league screens. Returns ALL ranked rows regardless of tier; use recommended_bets for the filtered TIER 1-2 shortlist. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Each row includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        properties: {
          includeAll: { type: 'boolean', description: 'Include rows even when consensus or movement data is missing' },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
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
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'ask',
      description:
        'Parse a natural language betting query into structured components (league, book, market, side, line, player) and suggest the best tool to call. Works as a query router — agents call this first, then call the suggested tool immediately. Examples: "best plays on Fliff today" → quick_screen(books=["Fliff"]), "Tatum over 29.5 points" → player_context(player="Tatum", sport="NBA"), "show me MLB moneyline picks" → recommended_bets(leagues=["MLB"], markets=["Moneyline"]). No data is fetched by this tool itself — it\'s a pure parser + router.',
      inputSchema: {
        type: 'object',
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
      name: 'ufc_card',
      description:
        'Query a UFC card and return a first-class shortlist response with official plays, best looks, passes, and summary metadata. Absolves the old per-league UFC shortcut.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        properties: {
          book: { type: 'string', description: 'Primary execution book for the UFC card query' },
          cardWindow: { type: 'string', description: 'Card window filter such as today, next, or all' },
          debug: { type: 'boolean', description: 'Include verbose movement debug payloads' },
          eventDate: { type: 'string', description: 'Restrict the shortlist to a specific card event date' },
          includePasses: { type: 'boolean', description: 'Include pass rows in the shortlist response' },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
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
        'Return only the highest-quality movement signals across requested leagues, ranked by signal strength. Each row includes movementGrade, riskScore (1-10), kaiCall (BET/CONSIDER/PASS), confidenceTier (TIER 1-4), consensusStrength (strong/moderate/weak/none), and a human-readable rationale string. The tier and kaiCall are quality ratings on the movement data (do sharp books really agree? is there a real line lag?), NOT predictions about which side will win. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. When aliases are resolved, `responseMeta.markets_alias_used` is set. Use this as your main "what is sharp money doing right now" tool. Defaults to scanning Moneyline, Spread, and Total markets. Pass `markets` to override.',
      inputSchema: {
        type: 'object',
        properties: {
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional book filter, e.g. ["NoVigApp", "Pinnacle"]'
          },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
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
          verbosity: VERBOSITY_PARAM
        },
        additionalProperties: false
      }
    },
    {
      name: 'staking_plan',
      description:
        'Given a bankroll and optional play filter, return stake allocations across recommended bets. Uses fractional Kelly staking: TIER 1 = 2%, TIER 2 = 1% of bankroll. Generic market names (e.g. "Total", "Spread") are auto-resolved per league. Each play includes `consensusStrength` (strong/moderate/weak/none). When aliases are resolved, `responseMeta.markets_alias_used` is set. Includes total exposure, per-play stake dollars, and correlation warnings. Defaults to scanning Moneyline, Spread, and Total markets via `recommended_bets`.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        properties: {
          bankroll: { type: 'number', description: 'Total bankroll in dollars, default 1000' },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          },
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
      name: 'mlb_game_context',
      description:
        'Get game-level context for an MLB game: starting pitchers (probable → confirmed), venue + park factor, hourly weather (wind speed/direction, temperature, precip probability) at first pitch, and lineup lock status. Returns a riskFlag of clean|low|medium|high for weather/park effects. Use BEFORE placing an MLB bet when the screen does not surface this. Automatically called by validate_play for league="MLB".',
      inputSchema: {
        type: 'object',
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
      name: 'get_play_details',
      description:
        'Get full details (including line history, consensus, movement debug) for specific plays by game ID. Generic market names are auto-resolved per league. Each row includes `consensusStrength` (strong/moderate/weak/none). Use AFTER a `screen_ranked` or `recommended_bets` call when you need the full raw payload for one or more specific gameIds — e.g. when `compact=true` or `fields=[]` hid the data you need. For confirming a play before betting, prefer `validate_play` (it bundles player_context + execution check). Returns full rows with all metadata.',
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
            description:
              'Game IDs to fetch full details for. These are the gameId values from screen rows. Deprecated alias — prefer the canonical "gameIds" param (same value, cleaner name). Both names accepted.'
          },
          gameIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Game IDs to fetch full details for. These are the gameId values from screen rows. Canonical name (preferred over "game_ids").'
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
        required: ['league', 'gameIds'],
        // Private hint consumed by lib/mcp-arg-validator.js#validateArgs.
        // Lets the required-check accept the deprecated "game_ids" alias so
        // existing callers don't break when the canonical name changes.
        __requiredAliases: { gameIds: ['game_ids'] },
        additionalProperties: false
      }
    },
    {
      name: 'validate_play',
      description:
        "Run all validation checks on a specific play in one call: re-fetch the latest screen data for the game, run player_context for injury/news, check execution quality on the requested book, and return a single verdict (BET / CONSIDER / PASS) with all supporting evidence. Use this after a screen_ranked or recommended_bets result to confirm a specific play before placing the bet. Equivalent to running get_play_details + player_context + a quick consensus check, but bundled so the agent doesn't have to chain three calls." +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        properties: {
          league: { type: 'string', description: 'League such as NBA, Tennis. Required.' },
          gameId: {
            type: 'string',
            description: 'Game ID from a prior screen_ranked row (gameId field). Required.'
          },
          selection: {
            type: 'string',
            description:
              'Player or team name from a prior screen_ranked row (selection or participant field). Required.'
          },
          market: { type: 'string', description: 'Market type, default Moneyline' },
          books: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Books to include in the validation, e.g. ["Fliff", "Pinnacle"]. Default uses the league preset.'
          },
          book: {
            type: 'string',
            description:
              'Execution book — the book you intend to place the bet on. Used for the executable-price check. Defaults to the first book in `books` or the league preset preferred book.'
          },
          lookbackHours: {
            type: 'number',
            description: 'Odds-history lookback window in hours, default 6'
          },
          skipResearch: {
            type: 'boolean',
            description:
              'When true, skip the player_context research step. Use this for ultra-fast validation when you only need odds/execution checks. Default false.'
          }
        },
        required: ['league', 'gameId', 'selection'],
        additionalProperties: false
      }
    },
    {
      name: 'league_presets',
      description:
        'Show the current sport-specific ranking presets — which books count as sharp per league, the default market bundles, and the preferred execution book. Call BEFORE `screen_ranked`, `recommended_bets`, or `validate_play` when you want to know which books/markets will be weighted highest, or when debugging unexpected ranking behavior. No arguments needed; result is informational only.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'health_status',
      description:
        'Check auth freshness and endpoint connectivity. Reports token persistence state: `persistedToDisk` (boolean), `refreshCount` (number of refreshes since startup), and `lastRefreshed` (ISO timestamp). Call FIRST THING on session boot to confirm the MCP server can reach the PropProfessor backend. If `persistedToDisk=false` or `lastRefreshed` is over 1 hour ago, expect auth failures on subsequent tool calls — surface `pp-query login` to the user. No arguments needed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'manage_hidden_bets',
      description:
        "Manage bet visibility for the /fantasy table. action='list' returns all hidden bets, 'hide' requires bet, 'unhide' requires id, 'clear' removes all.",
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'hide', 'unhide', 'clear'],
            description: 'Operation to perform on the hidden bets list'
          },
          bet: {
            type: 'object',
            description: "For action='hide': the bet object to hide (includes betId, matchId, market, selection)."
          },
          id: { type: 'string', description: "For action='unhide': the hidden bet ID to restore." }
        },
        required: ['action'],
        additionalProperties: false
      }
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
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live odds. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live odds. Canonical name (preferred over "is_live").'
          }
        },
        required: ['league', 'market', 'game', 'selection'],
        additionalProperties: false
      }
    },
    {
      name: 'get_market_registry',
      description:
        'Returns the list of markets available for a sport on a specific book. Use this BEFORE calling quick_screen to know which markets to query. Soccer uses Draw No Bet / Match Handicap / Total Goals (not Moneyline / Spread / Total).',
      inputSchema: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Sport name (e.g. Soccer, NBA, Tennis)' },
          book: { type: 'string', description: 'Book name (e.g. NoVigApp, DraftKings). If omitted, returns default markets for the sport.' },
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
            description: 'Optional confidence tier from recommended_bets or quick_screen'
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
        'Mark a logged pick as won, lost, or push after the game ends. Updates your personal betting record for accurate stats. Call ONCE PER PICK after the underlying game finishes, before fetching updated stats via `get_pick_stats`. Required: the pick UUID from `log_pick` or `get_pick_history`, plus the result enum (won / lost / push).',
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
        'Get your personal betting performance stats: win rate, profit/loss, breakdowns by league and confidence tier. Helps you see what strategies are working. Call for a SESSION OR WEEKLY RECAP — pass `days` to scope the window (default is all-time). For ROW-LEVEL history with status/league filters, use `get_pick_history` instead.',
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
      name: 'fantasy_optimizer',
      description:
        'Query the Fantasy Optimizer for DFS-style player picks across fantasy apps (PrizePicks, Underdog, etc.). Returns fantasy plays with projected values, odds, and risk metrics. Requires a paid PropProfessor subscription with Fantasy Optimizer access.',
      inputSchema: {
        type: 'object',
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
          },
          liveStatus: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by live status, e.g., ["pre"], ["live"].'
          },
          is_live: {
            type: 'boolean',
            description:
              'Whether to query live plays. Deprecated alias — prefer the canonical "live" param (same value, cleaner name). Both names accepted.'
          },
          live: {
            type: 'boolean',
            description: 'Whether to query live plays. Canonical name (preferred over "is_live").'
          },
          periodTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Period type filter, e.g., ["Full Game"].'
          },
          minHoursAway: { type: 'number', description: 'Minimum hours until game start.' },
          maxHoursAway: { type: 'number', description: 'Maximum hours until game start.' },
          minLiquidity: { type: 'number', description: 'Minimum liquidity filter.' },
          maxLiquidity: { type: 'number', description: 'Maximum liquidity filter.' }
        },
        additionalProperties: false
      }
    }
  ]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((tool) => ({
      ...tool,
      category: TOOL_CATEGORIES[tool.name] || 'meta'
    }));

  if (mode === 'lite') {
    return definitions.filter((tool) => LITE_MODE_TOOLS.has(tool.name));
  }
  return definitions;
}

module.exports = { buildToolDefinitions, LITE_MODE_TOOLS, TOOL_CATEGORIES };
