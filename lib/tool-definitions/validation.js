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

/** @returns {import('./types').ToolDefinition[]} */
function buildValidationTools() {
  return [
    {
      name: 'ev_candidates',
      description:
        'Query the +EV endpoint and return candidate plays for enabled books. Secondary discovery — use /screen for primary selection. Returns 0 rows on quiet days.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with leagues=["NBA"], validated=true.',
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
          showBreakOnly: { type: 'boolean' },
          showTimeoutOnly: { type: 'boolean' },
          showPeriodEndOnly: { type: 'boolean' },
          timeAvailable: { type: 'number' },
          userState: { type: 'string', description: 'User state code, default tx' },
          hideNCAAPlayerProps: { type: 'boolean' },
          weightSettings: { type: 'object', description: 'Optional backend weight-settings override object' },
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
      name: 'get_play_details',
      description:
        'Get full details (line history, consensus, movement debug) for specific plays by game ID. Use after a screen call when compact=true hid the data you need.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with league="NBA", gameIds=["id1","id2"].',
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
          },
          verbosity: VERBOSITY_PARAM
        },
        required: ['league', 'gameIds'],
        __requiredAliases: { gameIds: ['game_ids'] },
        additionalProperties: false
      }
    },
    {
      name: 'validate_play',
      description:
        'Run all validation checks on a play in one call: re-fetch screen data, run player_context, check execution quality, return BET/CONSIDER/PASS verdict.' +
        HONEST_SCOPE_CAVEAT,
      inputSchema: {
        type: 'object',
        usage_example: 'Call with league="NBA", gameId="id-from-screen", selection="Celtics", book="Fliff".',
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
      name: 'find_best_price',
      description:
        "Line shopping: show every book's odds sorted best to worst with spread from best price. Auto-resolves league-specific market names.",
      inputSchema: {
        type: 'object',
        usage_example: 'Call with league="NBA", market="Moneyline", game="Lakers vs Celtics", selection="Lakers".',
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
    }
  ];
}

module.exports = { buildValidationTools };
