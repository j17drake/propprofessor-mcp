/**
 * Quick tennis scan on NoVigApp — TIER 1 only
 * One-off, temp file.
 */
const path = require('path');
const repo = path.resolve(__dirname, '..');
process.chdir(repo);

const { createMcpHandlers } = require(path.join(__dirname, 'server', 'handlers'));

async function main() {
  const handlers = createMcpHandlers();

  const res = await handlers.quick_screen({
    leagues: ['Tennis'],
    book: 'NoVigApp',
    targetTiers: ['TIER 1'],
    onlyBets: true,
    sortBy: 'start',
    sortDir: 'asc',
    cardWindow: 'next',
    lite: true,
    verbosity: 'bets'
  });

  const output = {
    activeSlate: res.activeSlate,
    candidates: res.results?.map(r => ({
      league: r.league,
      market: r.market,
      plays: r.plays?.map(p => ({
        matchup: p.matchup,
        selection: p.selection,
        odds: p.odds,
        tier: p.tier,
        kaiCall: p.kaiCall || p.verdict,
        movement: p.movementDisposition,
        execQuality: p.executionQuality,
        edge: p.edge,
        consensusBooks: p.consensusBookCount,
        startCST: p.startCST,
        research: p.research ? { summary: p.research.summary?.slice(0, 500) } : null
      }))
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
