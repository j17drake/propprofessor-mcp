'use strict';

const { createPropProfessorClient } = require('../lib/propprofessor-api');
const { buildRankedScreenResponse } = require('../lib/propprofessor-mcp-ranked-screen');
const { rankLeagueScreenRows } = require('../lib/propprofessor-screen-utils');

async function main() {
  const client = createPropProfessorClient();
  const league = process.env.PP_SMOKE_LEAGUE || 'NBA';
  const market = process.env.PP_SMOKE_MARKET || 'Moneyline';
  const books = String(process.env.PP_SMOKE_BOOKS || 'NoVigApp')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const limit = Number(process.env.PP_SMOKE_LIMIT || 3);
  const lookbackHours = Number(process.env.PP_SMOKE_LOOKBACK_HOURS || 6);
  const debug = String(process.env.PP_SMOKE_DEBUG || 'false').trim().toLowerCase() === 'true';

  const payload = await client.queryScreenOddsBestComps({
    league,
    market,
    books,
    is_live: false
  });

  const result = await buildRankedScreenResponse({
    client,
    payloads: [payload],
    args: {
      books,
      historySportsbooks: books,
      limit,
      includeAll: true,
      lookbackHours,
      debug
    },
    league,
    focusBook: books[0] || null,
    rankRows: (hydratedRows, { debug: rankedDebug } = {}) => rankLeagueScreenRows(hydratedRows, {
      league,
      market,
      limit,
      includeAll: true,
      books,
      debug: rankedDebug
    })
  });

  const sample = (Array.isArray(result.result) ? result.result : []).slice(0, limit).map(row => ({
    participant: row.participant || row.selection || row.pick || null,
    book: row.book || null,
    odds: row.odds ?? row.currentOdds ?? null,
    freshnessSource: row.freshnessSource ?? null,
    rankingProvenance: row.rankingProvenance ?? null,
    movementDebugIncluded: Object.prototype.hasOwnProperty.call(row, 'movementDebug')
  }));

  console.log(JSON.stringify({
    ok: result.ok,
    league,
    market,
    books,
    lookbackHours,
    debug,
    freshness: result.freshness,
    resultMeta: result.resultMeta,
    sample
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { main };
