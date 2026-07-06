'use strict';

function buildPicksTools() {
  return [
    {
      name: 'log_pick',
      description:
        'Log a bet you placed before tip-off. Records game, league, market, selection, odds, stake, and optional metadata.',
      inputSchema: {
        type: 'object',
        usage_example:
          'Call with game="Lakers vs Celtics", league="NBA", market="Moneyline", selection="Lakers", odds=-150.',
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
        usage_example: 'Call with status="won", league="NBA".',
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
        usage_example: 'Call with id="uuid-from-log", result="won".',
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
        'Get your personal betting performance stats: win rate, profit/loss, breakdowns by league and confidence tier.',
      inputSchema: {
        type: 'object',
        usage_example: 'Call with days=30.',
        properties: {
          days: { type: 'number', description: 'Only include picks from the last N days' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'manage_hidden_bets',
      description:
        "Manage bet visibility for the /fantasy table. action='list' returns all hidden bets, 'hide' requires bet, 'unhide' requires id, 'clear' removes all.",
      inputSchema: {
        type: 'object',
        usage_example: 'Call with action="list".',
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
      inputSchema: { type: 'object', properties: {}, additionalProperties: false, usage_example: 'Call with no args.' }
    }
  ];
}

module.exports = { buildPicksTools };
