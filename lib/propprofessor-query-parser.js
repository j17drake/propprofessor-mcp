'use strict';

const LEAGUE_KEYWORDS = [
  ['Tennis', ['tennis', 'atp', 'wta']],
  ['NBA', ['nba', 'basketball', 'hoops']],
  ['MLB', ['mlb', 'baseball']],
  ['NFL', ['nfl', 'football']],
  ['NHL', ['nhl', 'hockey']],
  ['NCAAB', ['ncaab', 'college basketball', 'cbb']],
  ['NCAAF', ['ncaaf', 'college football', 'cfc']],
  ['WNBA', ['wnba']],
  ['Soccer', ['soccer', 'football match', 'premier league', 'uefa', 'liga']],
  ['UFC', ['ufc', 'mma', 'fight']],
  ['PGA', ['pga', 'golf', 'tour championship']],
  ['EuroLeague', ['euroleague']]
];

const BOOK_KEYWORDS = [
  'NoVigApp',
  'Polymarket',
  'Kalshi',
  'BetOnline',
  'Circa',
  'Fliff',
  'Rebet',
  'Underdog',
  'PrizePicks',
  'Dabble',
  'DraftKings6',
  'DraftKings',
  'FanDuel',
  'Caesars',
  'BetMGM',
  'Sleeper',
  'Betr'
];

const MARKET_KEYWORDS = [
  ['Pitcher Strikeouts', ['strikeouts', 'ks', 'k prop']],
  ['Player Hits + Runs + RBI', ['hits + runs + rbi', 'h+r+rbi', 'hr+rbi']],
  ['Player Total Bases', ['total bases']],
  ['Player Hits', ['hits']],
  ['Player Rebounds', ['rebounds']],
  ['Player Assists', ['assists']],
  ['Player Points + Rebounds + Assists', ['pra', 'points rebounds assists', 'points + rebounds + assists']],
  ['Player Points + Rebounds', ['points + rebounds', 'pts + reb']],
  ['Player Points + Assists', ['points + assists', 'pts + ast']],
  ['Player Points', ['points', 'pts', 'point prop']],
  ['Moneyline', ['moneyline', 'ml', 'money line']],
  ['Spread', ['spread', 'handicap', 'run line']],
  ['Total', ['total', 'over/under', 'ou']]
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesKeyword(text, keyword) {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedText || !normalizedKeyword) return false;
  const pattern = normalizedKeyword
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, 'i').test(normalizedText);
}

function inferPreferredBook(text) {
  const normalized = normalizeText(text);
  return BOOK_KEYWORDS.find(book => matchesKeyword(normalized, book)) || null;
}

function inferDefaultLeague(text) {
  const normalized = normalizeText(text);
  for (const [league, keywords] of LEAGUE_KEYWORDS) {
    if (keywords.some(keyword => matchesKeyword(normalized, keyword))) {
      return league;
    }
  }
  return null;
}

function inferDefaultMarket(text, league = null) {
  const normalized = normalizeText(text);
  for (const [market, keywords] of MARKET_KEYWORDS) {
    if (keywords.some(keyword => matchesKeyword(normalized, keyword))) {
      return market;
    }
  }
  if (league === 'Tennis' || normalized.includes('tennis')) {
    if (matchesKeyword(normalized, 'spread') || matchesKeyword(normalized, 'handicap')) return 'Spread';
    if (matchesKeyword(normalized, 'total') || matchesKeyword(normalized, 'over/under') || normalized.includes('ou')) return 'Total';
    return 'Moneyline';
  }
  return null;
}

function inferIntent(text) {
  const normalized = normalizeText(text);
  if (normalized.includes('fantasy') || normalized.includes('/fantasy')) return 'fantasy';
  if (normalized.includes('screen') || normalized.includes('/screen')) return 'screen';
  if (normalized.includes('best ') || normalized.startsWith('best') || normalized.includes('find ') || normalized.includes('edges') || normalized.includes('good')) {
    return 'screen';
  }
  return 'screen';
}

function parseSideAndLine(text) {
  const normalized = normalizeText(text).replace(/\b(a\s+)?good\s+bet\??$/i, '').trim();
  const match = normalized.match(/\b(over|under|o|u|\+|-)\s*(\d+(?:\.\d+)?)\b/i);
  if (!match) return { side: null, line: null };
  const sideToken = match[1].toLowerCase();
  return {
    side: sideToken === 'o' || sideToken === '+' ? 'over' : sideToken === 'u' || sideToken === '-' ? 'under' : sideToken,
    line: Number(match[2])
  };
}

function parsePlayer(text) {
  const normalized = String(text || '').trim();
  const propMatch = normalized.match(/^(?:is\s+)?(.+?)\s+(?:o|u|over|under|\+|-)\s*\d+(?:\.\d+)?\b/i);
  if (!propMatch) return null;

  let candidate = propMatch[1].trim();
  const bookPrefixes = [
    'Fliff', 'Rebet', 'Underdog', 'PrizePicks', 'NoVigApp', 'Polymarket', 'Kalshi',
    'BetOnline', 'Circa', 'FanDuel', 'DraftKings', 'Caesars', 'BetMGM', 'Sleeper',
    'Betr', 'Dabble', 'DraftKings6'
  ];
  for (const prefix of bookPrefixes) {
    candidate = candidate.replace(new RegExp(`^${escapeRegExp(prefix)}\\s+`, 'i'), '').trim();
  }

  const tokens = candidate.split(/\s+/).filter(Boolean);
  const stopTokens = new Set([
    'points', 'pts', 'rebounds', 'assists', 'blocks', 'steals', 'strikeouts', 'hits',
    'total', 'moneyline', 'spread', 'handicap', 'fantasy', 'good', 'bet', 'best', 'find', 'edges', 'today'
  ]);
  while (tokens.length > 1 && stopTokens.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(' ').trim() || candidate;
}

function parseNaturalLanguagePropQuery(text) {
  const raw = String(text || '').trim();
  const league = inferDefaultLeague(raw);
  const book = inferPreferredBook(raw);
  const market = inferDefaultMarket(raw, league);
  const intent = inferIntent(raw);
  const { side, line } = parseSideAndLine(raw);
  const player = parsePlayer(raw);

  return {
    raw,
    intent,
    league,
    book,
    market,
    side,
    line,
    player,
    query: raw || null
  };
}

module.exports = {
  inferDefaultLeague,
  inferDefaultMarket,
  inferIntent,
  inferPreferredBook,
  matchesKeyword,
  normalizeText,
  parseNaturalLanguagePropQuery
};
