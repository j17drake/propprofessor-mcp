'use strict';

function normalizeMarketName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['pts', 'point', 'points', 'player points', 'player point'].includes(raw)) return 'points';
  if (['ast', 'assists', 'player assists'].includes(raw)) return 'assists';
  if (['reb', 'rebound', 'rebounds', 'player rebounds'].includes(raw)) return 'rebounds';
  if (['pra', 'points + rebounds + assists', 'points rebounds assists'].includes(raw)) return 'points+rebounds+assists';
  return raw.replace(/\s+/g, ' ');
}

function normalizeDirection(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (['o', 'over', '+'].includes(raw)) return 'over';
  if (['u', 'under', '-'].includes(raw)) return 'under';
  return raw;
}

function parseBetPrompt(input) {
  const text = String(input || '').trim();
  const match = text.match(/^(?:is\s+)?(.+?)\s+([ou]|over|under)\s*(\d+(?:\.\d+)?)\s+([a-z+\s]+?)(?:\s+a\s+good\s+bet\??)?$/i);
  if (!match) {
    return { player: '', side: '', line: null, market: '' };
  }
  return {
    player: match[1].trim(),
    side: normalizeDirection(match[2]),
    line: Number(match[3]),
    market: normalizeMarketName(match[4])
  };
}

function scoreRow(query, row) {
  const text = JSON.stringify(row).toLowerCase();
  const marketText = normalizeMarketName(row.market || row.selection || '');
  let score = 0;
  if (query.player && text.includes(String(query.player).toLowerCase())) score += 4;
  if (query.market && marketText.includes(query.market)) score += 2;
  if (query.side && text.includes(normalizeDirection(query.side))) score += 1;
  if (query.line !== undefined && query.line !== null && text.includes(String(query.line))) score += 1;
  return score;
}

function americanOddsToImpliedProbability(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return (-n) / ((-n) + 100);
}

function extractNumericTrailValue(item) {
  if (typeof item === 'number') return Number.isFinite(item) ? item : null;
  if (!item || typeof item !== 'object') return null;
  const candidates = [item.odds, item.americanOdds, item.price, item.line, item.value, item.current, item.open, item.close];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractHistoryTrail(row) {
  const arrays = [row?.lineHistory, row?.oddsHistory, row?.priceHistory, row?.movementHistory, row?.history];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    const trail = arr.map(extractNumericTrailValue).filter(v => Number.isFinite(v));
    if (trail.length >= 2) return trail;
  }
  const open = extractNumericTrailValue({ odds: row?.openingOdds ?? row?.openOdds ?? row?.open_price ?? row?.openPrice ?? row?.startOdds ?? row?.startPrice });
  const current = extractNumericTrailValue({ odds: row?.currentOdds ?? row?.odds ?? row?.price ?? row?.bookOdds });
  if (Number.isFinite(open) && Number.isFinite(current)) return [open, current];
  return [];
}

function extractFreshnessTimestampMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractRowFreshnessMs(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [
    row.updatedAt,
    row.lastUpdated,
    row.lastUpdate,
    row.timestamp,
    row.time,
    row.createdAt,
    row.pulledAt,
    row.refreshedAt,
    row.asOf,
    row.scrapedAt,
    row.fetchedAt,
    row.snapshotAt,
    row.payload?.updatedAt,
    row.payload?.lastUpdated,
    row.meta?.updatedAt,
    row.meta?.timestamp
  ];
  for (const candidate of candidates) {
    const ms = extractFreshnessTimestampMs(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function summarizeFreshness(rows, nowMs = Date.now()) {
  const freshnessMs = (Array.isArray(rows) ? rows : [])
    .map(extractRowFreshnessMs)
    .filter(value => Number.isFinite(value))
    .map(value => Math.max(0, nowMs - value));
  if (!freshnessMs.length) {
    return { rowCount: Array.isArray(rows) ? rows.length : 0, newestAgeMs: null, oldestAgeMs: null, staleCount: 0, stale: false };
  }
  const newestAgeMs = Math.min(...freshnessMs);
  const oldestAgeMs = Math.max(...freshnessMs);
  return {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    newestAgeMs,
    oldestAgeMs,
    staleCount: 0,
    stale: false
  };
}

function extractScreenRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.game_data)) return payload.game_data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getTennisMarketName(row) {
  return normalizeMarketName(row?.market || row?.selection || row?.playType || row?.betType || '');
}

function isTennisRow(row) {
  const text = JSON.stringify(row || {}).toLowerCase();
  return text.includes('tennis') || String(row?.league || row?.sport || row?.gameType || '').toLowerCase().includes('tennis');
}

function normalizeTennisMarketQuery(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'moneyline' || raw === 'ml') return ['Moneyline'];
  if (raw.includes('spread') || raw.includes('handicap')) {
    return ['Game Handicap', 'Set Handicap', 'Point Spread'];
  }
  if (raw.includes('total') || raw.includes('over/under') || raw === 'ou') {
    return ['Total Sets', 'Total Games', 'Over/Under'];
  }
  return [String(value).trim()];
}

function normalizeLeagueName(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'NCAAB' || raw === 'COLLEGE BASKETBALL') return 'NCAAB';
  if (raw === 'NCAAF' || raw === 'COLLEGE FOOTBALL') return 'NCAAF';
  if (raw === 'WNBA' || raw === 'WOMENS BASKETBALL') return 'WNBA';
  if (raw === 'MLB' || raw === 'BASEBALL') return 'MLB';
  if (raw === 'NBA' || raw === 'BASKETBALL') return 'NBA';
  if (raw === 'NFL' || raw === 'FOOTBALL') return 'NFL';
  if (raw === 'NHL' || raw === 'HOCKEY') return 'NHL';
  if (raw === 'SOCCER' || raw === 'FUTBOL' || raw === 'FOOTBALL/SOCCER') return 'SOCCER';
  if (raw === 'TENNIS') return 'TENNIS';
  return raw;
}

function getLeagueRankingPreset(league) {
  const normalizedLeague = normalizeLeagueName(league);
  const presets = {
    NBA: {
      league: 'NBA',
      displayName: 'NBA',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 2.0,
      marketPriorities: [
        { match: 'player points', weight: 2.5 },
        { match: 'player rebounds', weight: 2.2 },
        { match: 'player assists', weight: 2.2 },
        { match: 'player pra', weight: 2.6 },
        { match: 'moneyline', weight: 1.4 },
        { match: 'spread', weight: 1.3 },
        { match: 'total', weight: 1.2 }
      ]
    },
    MLB: {
      league: 'MLB',
      displayName: 'MLB',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 2.05,
      marketPriorities: [
        { match: 'player strikeouts', weight: 2.6 },
        { match: 'player outs', weight: 2.5 },
        { match: 'player hits', weight: 2.2 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'run line', weight: 1.4 },
        { match: 'total', weight: 1.2 }
      ]
    },
    NFL: {
      league: 'NFL',
      displayName: 'NFL',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 2.0,
      marketPriorities: [
        { match: 'player passing yards', weight: 2.5 },
        { match: 'player rushing yards', weight: 2.4 },
        { match: 'player receptions', weight: 2.3 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.4 },
        { match: 'total', weight: 1.3 }
      ]
    },
    NHL: {
      league: 'NHL',
      displayName: 'NHL',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'player shots', weight: 2.4 },
        { match: 'player points', weight: 2.1 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'puck line', weight: 1.4 },
        { match: 'total', weight: 1.25 }
      ]
    },
    SOCCER: {
      league: 'SOCCER',
      displayName: 'Soccer',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'moneyline', weight: 1.6 },
        { match: 'spread', weight: 1.5 },
        { match: 'total', weight: 1.45 },
        { match: 'goal scorer', weight: 2.3 },
        { match: 'shots', weight: 2.0 },
        { match: 'corners', weight: 1.9 }
      ]
    },
    TENNIS: {
      league: 'TENNIS',
      displayName: 'Tennis',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.9,
      marketPriorities: [
        { match: 'moneyline', weight: 1.7 },
        { match: 'game handicap', weight: 2.2 },
        { match: 'set handicap', weight: 2.4 },
        { match: 'point spread', weight: 2.1 },
        { match: 'total sets', weight: 2.0 },
        { match: 'total games', weight: 1.8 }
      ]
    },
    NCAAB: {
      league: 'NCAAB',
      displayName: 'NCAAB',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.85,
      marketPriorities: [
        { match: 'player points', weight: 2.3 },
        { match: 'player rebounds', weight: 2.1 },
        { match: 'player assists', weight: 2.1 },
        { match: 'moneyline', weight: 1.4 },
        { match: 'spread', weight: 1.3 },
        { match: 'total', weight: 1.2 }
      ]
    },
    NCAAF: {
      league: 'NCAAF',
      displayName: 'NCAAF',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.9,
      marketPriorities: [
        { match: 'player passing yards', weight: 2.4 },
        { match: 'player rushing yards', weight: 2.3 },
        { match: 'player receptions', weight: 2.2 },
        { match: 'moneyline', weight: 1.5 },
        { match: 'spread', weight: 1.4 },
        { match: 'total', weight: 1.3 }
      ]
    },
    WNBA: {
      league: 'WNBA',
      displayName: 'WNBA',
      preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
      minimumScore: 1.95,
      marketPriorities: [
        { match: 'player points', weight: 2.4 },
        { match: 'player rebounds', weight: 2.2 },
        { match: 'player assists', weight: 2.2 },
        { match: 'moneyline', weight: 1.4 },
        { match: 'spread', weight: 1.3 },
        { match: 'total', weight: 1.2 }
      ]
    }
  };
  return presets[normalizedLeague] || {
    league: normalizedLeague || 'NBA',
    displayName: normalizedLeague || 'NBA',
    preferredBooks: ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'],
    minimumScore: 1.75,
    marketPriorities: [
      { match: 'moneyline', weight: 1.3 },
      { match: 'spread', weight: 1.2 },
      { match: 'total', weight: 1.1 }
    ]
  };
}

function getMarketPriorityScore(preset, marketText) {
  const normalizedMarket = String(marketText || '').toLowerCase();
  const priority = (preset?.marketPriorities || []).find(item => normalizedMarket.includes(item.match));
  return priority || null;
}

function passesLeagueRankingGate({ score, hasConsensus, hasLineMovement, leaguePreset, marketHintMatch }) {
  const minimumScore = Number(leaguePreset?.minimumScore);
  const hardFloor = Number.isFinite(minimumScore) ? minimumScore : 1.75;
  const hasSignal = Boolean(hasConsensus || hasLineMovement || marketHintMatch);
  if (!hasSignal) {
    return { passed: false, reason: 'no consensus, CLV, or market fit signal' };
  }
  if (!Number.isFinite(score)) {
    return { passed: false, reason: 'score unavailable' };
  }
  if (score < hardFloor) {
    return { passed: false, reason: `score ${score.toFixed(2)} below ${hardFloor.toFixed(2)} gate` };
  }
  return { passed: true, reason: `score ${score.toFixed(2)} passed ${hardFloor.toFixed(2)} gate` };
}

function filterRowsByLeague(rows, league) {
  const normalizedLeague = normalizeLeagueName(league);
  if (!normalizedLeague) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const text = JSON.stringify(row || {}).toUpperCase();
    return text.includes(normalizedLeague);
  });
}

function rankLeagueScreenRows(rows, { league = 'NBA', limit = 12, includeAll = false, maxAgeMs = null, books = [] } = {}) {
  const preset = getLeagueRankingPreset(league);
  const filteredRows = filterRowsByLeague(rows, preset.league);
  return rankScreenRows(filteredRows, {
    limit,
    preferredBooks: Array.isArray(books) && books.length ? books : preset.preferredBooks,
    includeAll,
    maxAgeMs
  }).map(row => ({
    ...row,
    leaguePreset: preset.displayName,
    rankingPreset: preset.displayName,
    rankingMarkets: (preset.marketPriorities || []).map(item => item.match)
  }));
}

function getScreenSelection(row) {
  if (!row || typeof row !== 'object') return null;
  const selections = row.selections;
  if (!selections || typeof selections !== 'object') return null;
  const preferredKey = row.defaultKey != null ? String(row.defaultKey) : null;
  if (preferredKey && selections[preferredKey]) return selections[preferredKey];
  const keys = Object.keys(selections);
  return keys.length ? selections[keys[0]] : null;
}

function average(values) {
  const nums = values.filter(value => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function expandScreenRow(row, { preferredBook = 'NoVigApp' } = {}) {
  const selection = getScreenSelection(row);
  const oddsMap = selection?.odds;
  const preferredOdds = oddsMap?.[preferredBook] || oddsMap?.NoVigApp;
  if (!preferredOdds) return [row];

  const compBooks = Object.entries(oddsMap)
    .filter(([book]) => book !== preferredBook)
    .map(([book, odds]) => ({ book, odds: odds || {} }));

  function buildSide(selectionLabel, fallbackParticipant, oddsKey) {
    const preferredProb = americanOddsToImpliedProbability(preferredOdds[oddsKey]);
    const consensusProb = average(compBooks.map(item => americanOddsToImpliedProbability(item.odds[oddsKey])));
    const hasConsensus = Number.isFinite(preferredProb) && Number.isFinite(consensusProb);
    return {
      ...row,
      participant: selectionLabel || fallbackParticipant || '',
      book: preferredBook,
      odds: preferredOdds[oddsKey],
      currentOdds: preferredOdds[oddsKey],
      consensusEdge: hasConsensus ? (consensusProb - preferredProb) * 100 : null,
      hasConsensus,
      consensusBookCount: compBooks.filter(item => Number.isFinite(americanOddsToImpliedProbability(item.odds[oddsKey]))).length
    };
  }

  return [
    buildSide(selection?.selection1 || selection?.participant1, row.participant || row.homeTeam, 'odds1'),
    buildSide(selection?.selection2 || selection?.participant2, row.awayTeam, 'odds2')
  ];
}

function rankScreenRows(rows, { limit = 12, preferredBooks = ['NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'], includeAll = false, maxAgeMs = null } = {}) {
  const preferredBook = Array.isArray(preferredBooks) && preferredBooks.length ? String(preferredBooks[0]) : 'NoVigApp';
  const numericMaxAgeMs = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : null;
  return (Array.isArray(rows) ? rows : [])
    .flatMap(row => expandScreenRow(row, { preferredBook }))
    .map(row => {
      const leaguePreset = getLeagueRankingPreset(row?.league || row?.sport || row?.gameType || '');
      const rowMarketName = String(row?.market || getTennisMarketName(row) || row?.selection || '').toLowerCase();
      const marketPriority = getMarketPriorityScore(leaguePreset, rowMarketName);
      const marketHintMatch = marketPriority ? marketPriority.match : null;
      const marketHintScore = marketPriority ? marketPriority.weight : 0;
      const trail = extractHistoryTrail(row);
      const openingOdds = trail.length >= 2 ? trail[0] : null;
      const currentOdds = trail.length >= 2 ? trail[trail.length - 1] : extractNumericTrailValue({ odds: row?.odds || row?.currentOdds || row?.price });
      const openingProb = americanOddsToImpliedProbability(openingOdds);
      const currentProb = americanOddsToImpliedProbability(currentOdds);
      const clvProxyPct = Number.isFinite(openingProb) && Number.isFinite(currentProb)
        ? (openingProb - currentProb) * 100
        : null;
      const rawConsensusEdge = row?.consensusEdge ?? row?.value ?? row?.ev ?? row?.edge;
      const consensusEdge = Number(rawConsensusEdge);
      const hasConsensus = Boolean(row?.hasConsensus) || Number.isFinite(consensusEdge);
      const book = String(row?.book || row?.sportsbook || '').trim();
      const preferredBookMatch = new RegExp(preferredBook, 'i').test(book) || new RegExp(preferredBook, 'i').test(JSON.stringify(row || {}));
      const hasLineMovement = Number.isFinite(clvProxyPct);
      const freshnessMs = extractRowFreshnessMs(row);
      const isStale = Number.isFinite(numericMaxAgeMs) && Number.isFinite(freshnessMs) ? (Date.now() - freshnessMs) > numericMaxAgeMs : false;
      const movementScore = hasLineMovement ? clvProxyPct * 1.5 : 0;
      const consensusScore = hasConsensus ? consensusEdge * 2 : 0;
      const sportScore = (hasConsensus || hasLineMovement) ? marketHintScore : 0;
      const freshnessPenalty = isStale ? -5 : 0;
      const score = consensusScore + movementScore + sportScore + freshnessPenalty;
      const gate = passesLeagueRankingGate({ score, hasConsensus, hasLineMovement, leaguePreset, marketHintMatch });
      const rankingReason = isStale
        ? `stale data older than ${Math.round(numericMaxAgeMs / 1000)}s, ${leaguePreset.displayName} preset, consensus edge${row?.consensusBookCount ? ` across ${row.consensusBookCount} comp books` : ''}${hasLineMovement ? ` and CLV proxy ${clvProxyPct.toFixed(2)}%` : ''}${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
        : hasConsensus
          ? `${leaguePreset.displayName} preset, ranked by consensus edge${row?.consensusBookCount ? ` across ${row.consensusBookCount} comp books` : ''}${hasLineMovement ? ` and CLV proxy ${clvProxyPct.toFixed(2)}%` : ''}${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
          : hasLineMovement
            ? `${leaguePreset.displayName} preset, ranked by line movement only, CLV proxy ${clvProxyPct.toFixed(2)}%${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`
            : `${leaguePreset.displayName} preset, unranked: no consensus comparison or line movement available${marketHintMatch ? `, market fit ${marketHintMatch}` : ''}`;
      return {
        row,
        score,
        freshnessMs,
        isStale,
        gatePassed: gate.passed,
        gateReason: gate.reason,
        leaguePreset: leaguePreset.displayName,
        marketHintMatch,
        consensusEdge: hasConsensus ? consensusEdge : null,
        clvProxyPct,
        openingOdds,
        currentOdds,
        market: rowMarketName || getTennisMarketName(row),
        book,
        preferredBookMatch,
        hasConsensus,
        hasLineMovement,
        consensusBookCount: Number(row?.consensusBookCount || 0),
        scoreBreakdown: {
          consensusScore: Number(consensusScore.toFixed(3)),
          movementScore: Number(movementScore.toFixed(3)),
          sportScore: Number(sportScore.toFixed(3)),
          freshnessPenalty: Number(freshnessPenalty.toFixed(3)),
          total: Number(score.toFixed(3))
        },
        rankingReason
      };
    })
    .filter(item => includeAll || item.gatePassed)
    .sort((a, b) => b.score - a.score || (Number(b.consensusEdge ?? -999) - Number(a.consensusEdge ?? -999)) || (Number(b.clvProxyPct ?? -999) - Number(a.clvProxyPct ?? -999)))
    .slice(0, limit)
    .map(item => ({
      ...item.row,
      consensusEdge: item.consensusEdge,
      clvProxyPct: item.clvProxyPct,
      openingOdds: item.openingOdds,
      currentOdds: item.currentOdds,
      freshnessMs: item.freshnessMs,
      stale: item.isStale,
      screenMarket: item.market,
      leaguePreset: item.leaguePreset,
      marketHintMatch: item.marketHintMatch,
      screenScore: Number(item.score.toFixed(3)),
      preferredBookMatch: item.preferredBookMatch,
      gatePassed: item.gatePassed,
      gateReason: item.gateReason,
      hasConsensus: item.hasConsensus,
      hasLineMovement: item.hasLineMovement,
      consensusBookCount: item.consensusBookCount,
      scoreBreakdown: item.scoreBreakdown,
      rankingReason: item.rankingReason
    }));
}

function rankTennisScreenRows(rows, { limit = 12, preferredBook = 'NoVigApp', includeAll = false, maxAgeMs = null } = {}) {
  const tennisRows = Array.isArray(rows) ? rows.filter(isTennisRow) : [];
  return rankScreenRows(tennisRows, { limit, preferredBooks: [preferredBook, 'NoVigApp', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'], includeAll, maxAgeMs }).map(row => ({
    ...row,
    tennisMarket: row.screenMarket,
    tennisScore: row.screenScore
  }));
}

function analyzePlayerPropBet(query, rows) {
  const normalizedQuery = {
    player: query.player || '',
    side: normalizeDirection(query.side),
    line: query.line !== undefined && query.line !== null ? Number(query.line) : null,
    market: normalizeMarketName(query.market)
  };

  const filteredRows = (Array.isArray(rows) ? rows : []).filter(row => {
    const rowText = JSON.stringify(row).toLowerCase();
    const rowMarket = normalizeMarketName(row.market || row.selection || '');
    if (normalizedQuery.player && !rowText.includes(String(normalizedQuery.player).toLowerCase())) return false;
    if (normalizedQuery.market && !rowMarket.includes(normalizedQuery.market)) return false;
    return true;
  });

  const candidates = filteredRows
    .map(row => ({ row, score: scoreRow(normalizedQuery, row) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (Number(b.row.ev || 0) - Number(a.row.ev || 0)));

  const best = candidates[0]?.row || null;
  if (!best) {
    return {
      player: normalizedQuery.player,
      market: normalizedQuery.market,
      line: normalizedQuery.line,
      side: normalizedQuery.side,
      verdict: 'pass',
      confidence: 0,
      bestMatch: null,
      alternatives: [],
      rationale: ['No matching market found']
    };
  }

  const ev = Number(best.ev || 0);
  const verdict = ev > 0 ? 'yes' : ev < 0 ? 'no' : 'pass';
  return {
    player: normalizedQuery.player,
    market: normalizedQuery.market,
    line: normalizedQuery.line,
    side: normalizedQuery.side,
    verdict,
    confidence: Math.min(95, 50 + Math.abs(ev) * 5),
    bestMatch: best,
    alternatives: candidates.slice(1, 5).map(item => item.row),
    rationale: [
      `Best match EV: ${ev}`,
      `Matched market: ${best.market || best.selection || 'unknown'}`
    ]
  };
}

module.exports = {
  analyzePlayerPropBet,
  americanOddsToImpliedProbability,
  extractHistoryTrail,
  extractScreenRows,
  isTennisRow,
  normalizeLeagueName,
  normalizeTennisMarketQuery,
  normalizeDirection,
  normalizeMarketName,
  rankScreenRows,
  rankTennisScreenRows,
  rankLeagueScreenRows,
  getLeagueRankingPreset,
  getMarketPriorityScore,
  passesLeagueRankingGate,
  parseBetPrompt,
  summarizeFreshness,
  extractRowFreshnessMs
};
