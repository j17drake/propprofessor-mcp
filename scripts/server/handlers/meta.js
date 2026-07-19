'use strict';

/**
 * Meta handlers: self-documentation, market registry, league presets.
 */

const { buildLeaguePresetSummary } = require('../../../lib/league-presets');
const { getMarketsForSport } = require('../../../lib/propprofessor-market-registry');
const { getScoreTimelineStats } = require('../../../lib/propprofessor-risk-score');

/**
 * @param {import('../../lib/propprofessor-api').PropProfessorClient} client
 * @param {import('./handler-context').HandlerContext} ctx
 */
function createMetaHandlers(client, ctx) {
  return {
    async league_presets() {
      return { ok: true, result: buildLeaguePresetSummary() };
    },

    async get_market_registry(args = {}) {
      const sport = String(args.sport || '').trim();
      const book = args.book ? String(args.book).trim() : null;
      if (!sport) {
        return { ok: false, error: { code: 'MISSING_PARAMS', message: 'sport is required' } };
      }
      const markets = getMarketsForSport(sport, book);
      return {
        ok: true,
        sport,
        book: book || 'default',
        markets,
        note:
          sport.toUpperCase() === 'SOCCER'
            ? 'Soccer uses Draw No Bet (not Moneyline), Match Handicap (not Spread), and Total Goals'
            : undefined
      };
    },

    async get_started(args = {}) {
      const userType = args.user_type || 'intermediate';

      const workflows = {
        casual: {
          summary: 'For casual bettors who just want top picks.',
          prompt: [
            '1. Call today({ leagues: [...], book: "NoVigApp" }) for a one-call briefing — sharp slate + your pending picks + recent stats.',
            '2. For quick picks: quick_screen({ book: "NoVigApp", kaiCall: ["BET"], sortBy: "start", verbosity: "minimal" }). Present the top 3-5 plays.',
            '3. Before recommending: player_context({ player, sport }) for injury/availability flags.',
            '4. Skip sharp_consensus and ev_candidates — those are for advanced users.'
          ],
          key_tools: ['today', 'quick_screen', 'player_context'],
          pitfall: 'tier/kaiCall/edge are signal-quality ratings, not win predictions. TIER 1 means sharp books agree — it does not mean the side will win.'
        },
        intermediate: {
          summary: 'For bettors who understand edge and tier.',
          prompt: [
            '1. Call today() for a one-call briefing (slate + your pending picks + stats).',
            '2. For deeper scanning: quick_screen({ leagues: [...], book: "NoVigApp", kaiCall: ["BET"], sortBy: "start", verbosity: "standard" }).',
            '3. Before recommending any play: validate_play({ league, gameId, playId, market, book }) — always pass playId from the screen row.',
            '4. Check player_context({ player, sport }) for injury flags on final picks.',
            '5. Optionally: find_best_price({ league, market, game, selection }) to line-shop.',
            '6. To bet: place_bet({ league, gameId, playId, selection, market, book, stake }). It validates first and rejects PASS plays.',
            '7. After games settle: resolve_pick({ id, result }) for each logged pick.'
          ],
          key_tools: ['today', 'quick_screen', 'validate_play', 'player_context', 'place_bet', 'resolve_pick', 'find_best_price'],
          pitfall: 'Always pass playId to validate_play — bare selection strings fail. Use league-specific market names (get_market_registry for the mapping).'
        },
        sharp: {
          summary: 'For experienced bettors who want full control.',
          prompt: [
            '1. Call today() for the briefing, then screen_ranked({ league: "...", market: "..." }) for raw per-league screen data.',
            '2. For multi-book comparison: sharp_consensus({ league: "...", market: "..." }) shows book-vs-book lineup.',
            '3. Use smart_bet({ selection: "...", book: "..." }) for a full evaluation (screen + validation + pricing + staking).',
            '4. For props: ev_candidates({ league: "NBA", market: "Player Points" }) returns highest-edge player props across books.',
            '5. Monitor: sharp_alerts({ books: ["NoVigApp"], minFinalTier: "TIER 1" }) for on-demand BET-tier plays.',
            '6. Track: get_pick_history() and get_pick_stats() for your logged bets.'
          ],
          key_tools: ['today', 'screen_ranked', 'sharp_consensus', 'smart_bet', 'ev_candidates', 'sharp_alerts', 'get_pick_history'],
          pitfall: 'Live data screens are best with cardWindow parameter. Filter to 2-3 core markets (Moneyline, Spread, Total) for responsiveness.'
        }
      };

      const workflow = workflows[userType] || workflows.intermediate;

      return {
        summary: workflow.summary,
        steps: workflow.prompt,
        tools_to_use: workflow.key_tools,
        avoid: userType === 'casual' ? ['sharp_consensus', 'ev_candidates', 'resolve_pick'] : undefined,
        tool_descriptions: [
          {
            name: 'quick_screen',
            one_liner: 'Curated TIER 1-2 plays across leagues. Defaults to NoVigApp.',
            when_to_call: 'Your main "what should I bet" tool. Default to verbosity="minimal" for plain English.'
          },
          {
            name: 'today',
            one_liner: 'One-call briefing: sharp slate + pending picks + stats.',
            when_to_call: 'First call of the day. Gets you oriented.'
          },
          {
            name: 'validate_play',
            one_liner: 'Re-screen a single play with live odds + injury research.',
            when_to_call: 'Always before betting. Pass playId from the screen row.'
          },
          {
            name: 'player_context',
            one_liner: 'Injury / availability / recent-tweet research for a player.',
            when_to_call: 'On any play before recommending it. Pass the player name and league.'
          },
          {
            name: 'sharp_alerts',
            one_liner: 'On-demand BET-tier plays (finalVerdict=BET, clean research).',
            when_to_call: 'When you want "any new sharp plays right now?"'
          }
        ],
        honest_scope:
          'tier/kaiCall/edge/screenScore are quality ratings on what sharp books are doing — NOT predictions about which side will win. ... Profitability is UNPROVEN. No settled-results backtest has been published yet. Use this tool to discover candidate plays and validate them yourself; do not treat outputs as a guaranteed winning system.'
      };
    }
  };
}

module.exports = { createMetaHandlers };
