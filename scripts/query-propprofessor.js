'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { analyzePlayerPropBet, parseBetPrompt, rankScreenRows, rankTennisScreenRows, rankLeagueScreenRows, extractScreenRows, summarizeFreshness, getLeagueRankingPreset } = require('../lib/propprofessor-analysis');

function parseArgs(argv) {
  const args = argv.slice(2);
  const [command = 'help'] = args;
  const opts = {};

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--player' || arg === '-p') {
      opts.player = next;
      i += 1;
    } else if (arg === '--market' || arg === '-m') {
      opts.market = next;
      i += 1;
    } else if (arg === '--line' || arg === '-l') {
      opts.line = next;
      i += 1;
    } else if (arg === '--side' || arg === '-s') {
      opts.side = next;
      i += 1;
    } else if (arg === '--limit') {
      opts.limit = next;
      i += 1;
    } else if (arg === '--league' || arg === '-g') {
      opts.league = next;
      i += 1;
    } else if (arg === '--books' || arg === '-b') {
      opts.books = next;
      i += 1;
    } else if (arg === '--live') {
      opts.live = true;
    } else if (arg === '--json') {
      opts.json = true;
    }
  }

  return { command, opts };
}

function extractRows(payload) {
  return extractScreenRows(payload);
}

async function main({ argv = process.argv, client = createPropProfessorClient(), logger = console } = {}) {
  const { command, opts } = parseArgs(argv);
  if (command === 'help') {
    logger.log('Usage: node scripts/query-propprofessor.js opinion --player "James Harden" --market "Points" --line 18.5 --side over');
    process.exitCode = 0;
    return;
  }

  if (command === 'opinion') {
    const rows = extractRows(await client.querySportsbook());
    const query = {
      player: opts.player,
      market: opts.market,
      line: opts.line !== undefined ? Number(opts.line) : undefined,
      side: opts.side
    };
    const result = analyzePlayerPropBet(query, rows);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let payload;
  if (command === 'sportsbook') {
    payload = await client.querySportsbook();
  } else if (command === 'smart') {
    payload = await client.querySmartMoney();
  } else if (command === 'fantasy') {
    payload = await client.queryFantasyPicks();
  } else if (command === 'tennis') {
    payload = await client.queryScreenOddsBestComps({
      league: 'Tennis',
      market: opts.market || 'Moneyline',
      books: opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : undefined,
      is_live: Boolean(opts.live)
    });
  } else if (command === 'screen') {
    payload = await client.queryScreenOddsBestComps({
      league: opts.league || 'NBA',
      market: opts.market || 'Moneyline',
      books: opts.books ? String(opts.books).split(',').map(s => s.trim()).filter(Boolean) : undefined,
      is_live: Boolean(opts.live)
    });
  } else if (command === 'presets') {
    const leagues = ['NBA', 'MLB', 'NFL', 'NHL', 'SOCCER', 'TENNIS', 'NCAAB', 'NCAAF'];
    const presets = leagues.map(league => getLeagueRankingPreset(league));
    console.log(JSON.stringify({ command, presets }, null, 2));
    return;
  } else if (command === 'health') {
    const result = await client.healthStatus();
    console.log(JSON.stringify({ command, ...result }, null, 2));
    return;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  const rows = extractRows(payload);
  if (command === 'tennis') {
    const ranked = rankTennisScreenRows(rows, { limit: opts.limit ? Number(opts.limit) : 12, includeAll: true, maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null });
    console.log(JSON.stringify({
      command,
      count: ranked.length,
      sample: ranked,
      freshness: summarizeFreshness(rows),
      notes: {
        consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
        clvProxy: 'open odds vs current odds when history fields are present',
        movementAvailable: ranked.some(row => row.clvProxyPct !== null)
      }
    }, null, 2));
    return;
  }

  if (command === 'screen') {
    const ranked = rankLeagueScreenRows(rows, { league: opts.league || 'NBA', limit: opts.limit ? Number(opts.limit) : 12, includeAll: true, maxAgeMs: opts.maxAgeMs ? Number(opts.maxAgeMs) : null });
    console.log(JSON.stringify({
      command,
      count: ranked.length,
      sample: ranked,
      freshness: summarizeFreshness(rows),
      notes: {
        consensusEdgeSource: 'row.value/row.ev/row.edge if exposed by PP',
        clvProxy: 'open odds vs current odds when history fields are present',
        movementAvailable: ranked.some(row => row.clvProxyPct !== null)
      }
    }, null, 2));
    return;
  }

  const filtered = rows.filter(row => {
    const text = JSON.stringify(row).toLowerCase();
    const playerOk = !opts.player || text.includes(String(opts.player).toLowerCase());
    const marketOk = !opts.market || text.includes(String(opts.market).toLowerCase());
    const lineOk = opts.line === undefined || text.includes(String(opts.line));
    const sideOk = !opts.side || text.includes(String(opts.side).toLowerCase());
    return playerOk && marketOk && lineOk && sideOk;
  });
  console.log(JSON.stringify({ command, count: filtered.length, sample: filtered.slice(0, 10) }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  extractRows,
  main
};
