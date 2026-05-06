'use strict';

const DEFAULT_SHARP_BOOKS = ['Pinnacle', 'Polymarket', 'Kalshi', 'BetOnline', 'Circa'];
const NBA_MAIN_MARKET_SHARP_BOOKS = ['Circa', 'Pinnacle', 'BookMaker', 'BetOnline', 'DraftKings'];
const NBA_PROP_MARKET_SHARP_BOOKS = ['FanDuel', 'BookMaker', 'PropBuilder', 'NoVigApp', 'Pinnacle'];
const NFL_MAIN_MARKET_SHARP_BOOKS = ['Circa', 'Pinnacle', 'BookMaker', 'NoVigApp', 'FanDuel'];
const NFL_PROP_MARKET_SHARP_BOOKS = ['Pinnacle', 'FanDuel', 'BookMaker', 'Circa', 'BetOnline'];
const MLB_MAIN_MARKET_SHARP_BOOKS = ['Pinnacle', 'Circa', 'BookMaker', 'BetOnline', 'DraftKings', 'BetMGM'];
const MLB_PROP_MARKET_SHARP_BOOKS = ['Circa', 'FanDuel', 'PropBuilder', 'Pinnacle', 'DraftKings', 'Bet365'];

function uniqueBooks(books) {
  return Array.from(new Set((Array.isArray(books) ? books : [])
    .map(book => String(book || '').trim())
    .filter(Boolean)));
}

function normalizeLeague(league) {
  return String(league || '').trim().toUpperCase();
}

function normalizeMarket(market) {
  return String(market || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isPrimaryMainMarket(market) {
  const normalizedMarket = normalizeMarket(market);
  if (!normalizedMarket) return true;
  return [
    'moneyline',
    'spread',
    'point spread',
    'run line',
    'total',
    'team total',
    'total runs'
  ].some(token => normalizedMarket.includes(token));
}

function isNbaLeague(league) {
  return normalizeLeague(league) === 'NBA';
}

function isNflLeague(league) {
  return normalizeLeague(league) === 'NFL';
}

function isMlbLeague(league) {
  return normalizeLeague(league) === 'MLB';
}

function isMlbMainMarket(market) {
  const normalizedMarket = normalizeMarket(market);
  if (!normalizedMarket) return true;
  return [
    'moneyline',
    'run line',
    'spread',
    'point spread',
    'total',
    'team total',
    'total runs',
    'moneyline - 1st inning',
    'run line - 1st inning',
    'total runs - 1st inning',
    'team total runs - 1st inning',
    'first inning'
  ].some(token => normalizedMarket.includes(token));
}

function isMlbPropMarket(market) {
  const normalizedMarket = normalizeMarket(market);
  if (!normalizedMarket) return false;
  return !isMlbMainMarket(normalizedMarket);
}

function getSharpBookComparisonSet({ league, market, requestedBooks } = {}) {
  const requested = uniqueBooks(requestedBooks);
  if (requested.length) return requested;
  if (isNbaLeague(league)) {
    return isPrimaryMainMarket(market) ? [...NBA_MAIN_MARKET_SHARP_BOOKS] : [...NBA_PROP_MARKET_SHARP_BOOKS];
  }
  if (isNflLeague(league)) {
    return isPrimaryMainMarket(market) ? [...NFL_MAIN_MARKET_SHARP_BOOKS] : [...NFL_PROP_MARKET_SHARP_BOOKS];
  }
  if (isMlbLeague(league)) {
    return isMlbPropMarket(market) ? [...MLB_PROP_MARKET_SHARP_BOOKS] : [...MLB_MAIN_MARKET_SHARP_BOOKS];
  }
  return [...DEFAULT_SHARP_BOOKS];
}

function getSharpBookContext({ league, market } = {}) {
  const books = getSharpBookComparisonSet({ league, market });

  if (isNbaLeague(league)) {
    if (isPrimaryMainMarket(market)) {
      return {
        key: 'nba_main',
        label: 'NBA main markets',
        source: 'Pikkit sharp-book analysis, Dec 2024',
        books,
        notes: [
          'Circa leads NBA main markets, followed by Pinnacle, BookMaker, BetOnline, and DraftKings.',
          'Use this set for NBA moneylines, spreads, and totals.'
        ]
      };
    }
    return {
      key: 'nba_props',
      label: 'NBA secondary markets and player props',
      source: 'Pikkit sharp-book analysis, Dec 2024',
      books,
      notes: [
        'FanDuel leads NBA props, followed by BookMaker, PropBuilder, NoVigApp, and Pinnacle.',
        'Use the prop-specific ordering instead of the main-market hierarchy for NBA player markets.'
      ]
    };
  }

  if (isNflLeague(league)) {
    if (isPrimaryMainMarket(market)) {
      return {
        key: 'nfl_main',
        label: 'NFL main markets',
        source: 'Pikkit sharp-book analysis, Dec 2024',
        books,
        notes: [
          'Circa leads NFL main markets, followed by Pinnacle, BookMaker, NoVigApp, and FanDuel.',
          'Use this set for NFL moneylines, spreads, and totals.'
        ]
      };
    }
    return {
      key: 'nfl_props',
      label: 'NFL secondary markets and player props',
      source: 'Pikkit sharp-book analysis, Dec 2024',
      books,
      notes: [
        'Pinnacle leads NFL props, followed by FanDuel, BookMaker, Circa, and BetOnline.',
        'Use the prop-specific ordering instead of the main-market hierarchy for NFL player markets.'
      ]
    };
  }

  if (isMlbLeague(league)) {
    if (isMlbPropMarket(market)) {
      return {
        key: 'mlb_props',
        label: 'MLB secondary markets and player props',
        source: 'PromoGuy and Pikkit sharp-book hierarchy',
        books,
        notes: [
          'Use Circa and FanDuel as the top sharp references for MLB props, with PropBuilder, Pinnacle, DraftKings, and Bet365 next in line.'
        ]
      };
    }
    return {
      key: 'mlb_main',
      label: 'MLB main markets',
      source: 'PromoGuy and Pikkit sharp-book hierarchy',
      books,
      notes: [
        'Use Pinnacle as the primary anchor for MLB moneylines, spreads, and totals.',
        'Circa, BookMaker, BetOnline, DraftKings, and BetMGM round out the preferred MLB main-market comp set.'
      ]
    };
  }

  return {
    key: 'default',
    label: 'Default sharp comparison set',
    source: 'Cross-sport sharp-book baseline',
    books,
    notes: [
      'Uses the cross-sport default sharp set built around Pinnacle, Polymarket, Kalshi, BetOnline, and Circa.'
    ]
  };
}

module.exports = {
  DEFAULT_SHARP_BOOKS,
  NBA_MAIN_MARKET_SHARP_BOOKS,
  NBA_PROP_MARKET_SHARP_BOOKS,
  NFL_MAIN_MARKET_SHARP_BOOKS,
  NFL_PROP_MARKET_SHARP_BOOKS,
  MLB_MAIN_MARKET_SHARP_BOOKS,
  MLB_PROP_MARKET_SHARP_BOOKS,
  getSharpBookComparisonSet,
  getSharpBookContext,
  isPrimaryMainMarket,
  uniqueBooks
};
