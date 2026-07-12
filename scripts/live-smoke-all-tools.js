'use strict';

const { buildToolDefinitions } = require('../lib/propprofessor-tool-definitions');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');
const { createPropProfessorClient } = require('../lib/propprofessor-api');

// Minimal valid arg shapes per tool — enough to exercise the handler without
// forcing a specific result. Tools that need a live gameId use a placeholder;
// we only care that the handler runs without throwing on the live API.
const ARGS = {
  ask: { query: 'best WNBA play on NoVigApp tonight' },
  today: { leagues: ['WNBA'], book: 'NoVigApp', limit: 3 },
  get_market_registry: { sport: 'Soccer' },
  quick_screen: { leagues: ['WNBA'], book: 'NoVigApp', limit: 3, validate: false },
  recommended_bets: { leagues: ['WNBA'], book: 'NoVigApp' },
  screen_ranked: { league: 'WNBA', market: 'Moneyline' },
  all_slates: { book: 'NoVigApp' },
  ev_candidates: { leagues: ['NBA', 'MLB'] },
  sharp_plays: { league: 'NBA', market: 'Moneyline' },
  sharp_consensus: { league: 'NBA', market: 'Moneyline' },
  get_play_details: { league: 'WNBA', game_ids: ['WNBA:PREMATCH:NYL:LV:123'] },
  player_context: { player: 'Ohtani', league: 'MLB' },
  find_best_price: { league: 'NBA', selection: 'Lakers', market: 'Moneyline' },
  get_alerts: { leagues: ['WNBA'] },
  sharp_alerts: { leagues: ['WNBA'] },
  staking_plan: { picks: [{ tier: 'TIER 1', stake: 100 }] },
  fantasy_optimizer: { fantasyApps: ['PrizePicks'], leagues: ['NBA'] },
  mlb_game_context: { gameId: 'MLB:PREMATCH:NYY:BOS:123' },
  ufc_card: { event: 'UFC 300' },
  smart_bet: { league: 'NBA', market: 'Moneyline', selection: 'Lakers', book: 'NoVigApp' },
  smart_money: { league: 'NBA', sportsbooks: ['Pinnacle', 'Circa'] },
  tonight_bets: { leagues: ['WNBA'], book: 'NoVigApp' },
  validate_play: { league: 'WNBA', gameId: 'WNBA:PREMATCH:NYL:LV:123', selection: 'Liberty', market: 'Moneyline', book: 'NoVigApp' },
  place_bet: { league: 'WNBA', gameId: 'WNBA:PREMATCH:NYL:LV:123', selection: 'Liberty', market: 'Moneyline', book: 'NoVigApp', odds: -110, stake: 10 },
  log_pick: { game: 'Test Game', league: 'WNBA', market: 'Moneyline', selection: 'Liberty', odds: -110 },
  resolve_pick: { id: '00000000-0000-0000-0000-000000000000', result: 'won' },
  get_pick_history: { status: 'pending' },
  get_pick_stats: { days: 30 },
  manage_hidden_bets: { action: 'list' },
  clear_score_timeline: {},
  get_started: { user_type: 'intermediate' },
  health_status: {},
  league_presets: {}
};

const SKIP = new Set(); // tools that need auth-dependent write state we don't want in smoke

(async () => {
  const handlers = createMcpHandlers({ client: createPropProfessorClient() });
  const defs = buildToolDefinitions();
  const names = defs.map((d) => d.name).sort();

  let ok = 0;
  let fail = 0;
  const failures = [];

  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))
    ]);

  for (const name of names) {
    const args = ARGS[name] || {};
    try {
      const r = await withTimeout(handlers[name](args), 20000);
      ok++;
      process.stdout.write(`ok   ${name}\n`);
    } catch (err) {
      fail++;
      failures.push({ name, error: err.message });
      process.stdout.write(`FAIL ${name}: ${err.message}\n`);
    }
  }

  process.stdout.write(`\n=== ${ok} ok, ${fail} fail of ${names.length} tools ===\n`);
  if (failures.length) {
    process.stdout.write('Failures:\n');
    for (const f of failures) process.stdout.write(`  ${f.name}: ${f.error}\n`);
    process.exit(1);
  }
})();
