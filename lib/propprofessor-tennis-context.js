'use strict';

const cp = require('child_process');

// Same pattern as propprofessor-news-sources.js: recreate promise each call
// so tests that mock cp.execFile by reassignment are honored.
const pExecFile = (...args) =>
  new Promise((resolve, reject) => {
    cp.execFile(...args, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr });
    });
  });

const CURL_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Surface detection: ordered from most specific to most general so that
// tournaments that contain multiple keywords match the correct surface.
// ---------------------------------------------------------------------------

/** @type {Array<{pattern: RegExp, surface: string}>} */
const SURFACE_PATTERNS = [
  // Clay
  { pattern: /\b(?:Roland\s*Garros|French\s*Open)\b/i,               surface: 'Clay' },
  { pattern: /\b(?:Monte\s*Carlo|Rolex\s*Monte\s*Carlo)\b/i,          surface: 'Clay' },
  { pattern: /\b(?:Internazionali\s*Bnl\s*D|Italian\s*Open|Rome)\b/i, surface: 'Clay' },
  { pattern: /\b(?:Mutua\s*Madrid|Madrid\s*Open)\b/i,                 surface: 'Clay' },
  { pattern: /\b(?:Hamburg|German\s*Open)\b/i,                        surface: 'Clay' },
  { pattern: /\b(?:Swiss\s*Open|Gstaad)\b/i,                          surface: 'Clay' },
  { pattern: /\b(?:Swedish\s*Open|Bastad)\b/i,                        surface: 'Clay' },
  { pattern: /\b(?:Croatia\s*Open|Umag)\b/i,                          surface: 'Clay' },
  { pattern: /\b(?:Austrian\s*Open|Kitzbuhel|Generali)\b/i,           surface: 'Clay' },
  { pattern: /\b(?:Argentina\s*Open|Buenos\s*Aires)\b/i,              surface: 'Clay' },
  { pattern: /\b(?:Rio\s*Open|Rio\s*de\s*Janeiro)\b/i,               surface: 'Clay' },
  { pattern: /\b(?:Chile\s*Open|Santiago|Movistar)\b/i,               surface: 'Clay' },
  { pattern: /\b(?:Cordoba|Córdoba)\b/i,                               surface: 'Clay' },
  { pattern: /\b(?:Sao\s*Paulo|Brasil)\s*Open\b/i,                    surface: 'Clay' },
  { pattern: /\b(?:Marrakech|Grand\s*Prix\s*Hassan\s*Ii)\b/i,         surface: 'Clay' },
  { pattern: /\b(?:Estoril|Portugal\s*Open)\b/i,                      surface: 'Clay' },
  { pattern: /\b(?:Bucharest|Romanian|Tiriac)\b/i,                    surface: 'Clay' },
  { pattern: /\b(?:Munich|BMW\s*Open|Bavarian)\b/i,                   surface: 'Clay' },
  { pattern: /\b(?:Geneva|Gonet)\b/i,                                  surface: 'Clay' },
  { pattern: /\b(?:Lyon|Open\s*Parc)\b/i,                              surface: 'Clay' },
  { pattern: /\b(?:Bordeaux)\b/i,                                      surface: 'Clay' },
  { pattern: /\b(?:Aix-en-Provence)\b/i,                               surface: 'Clay' },
  { pattern: /\bClay\b/i,                                              surface: 'Clay' },

  // Grass
  { pattern: /\b(?:Wimbledon)\b/i,                                     surface: 'Grass' },
  { pattern: /\b(?:Queen[''']s|Queen\s*Club|cinch\s*Championships?)\b/i, surface: 'Grass' },
  { pattern: /\b(?:Eastbourne|Rothesay\s*International)\b/i,          surface: 'Grass' },
  { pattern: /\b(?:Halle|Gerry\s*Weber|Terra\s*Wortmann)\b/i,         surface: 'Grass' },
  { pattern: /\b(?:Stuttgart\s*(?:Open|Weissenhof))\b/i,              surface: 'Grass' },
  { pattern: /\b(?:Newport|Hall\s*of\s*Fame)\b/i,                     surface: 'Grass' },
  { pattern: /\b(?:Mallorca|Majorca)\b/i,                              surface: 'Grass' },
  { pattern: /\b(?:s[''']?Hertogenbosch|Rosmalen|Libema)\b/i,          surface: 'Grass' },
  { pattern: /\b(?:Nottingham|Nature\s*Valley)\b/i,                    surface: 'Grass' },
  { pattern: /\b(?:Ilkley)\b/i,                                        surface: 'Grass' },
  { pattern: /\bGrass\b/i,                                             surface: 'Grass' },

  // Carpet (rare, legacy)
  { pattern: /\bCarpet\b/i,                                            surface: 'Carpet' },

  // Indoor hard — must match before generic "hard"
  { pattern: /\b(?:Paris\s*(?:Masters?|Bercy|Rolex))\b/i,             surface: 'Indoor' },
  { pattern: /\b(?:Basel|Swiss\s*Indoors|Davidoff)\b/i,                surface: 'Indoor' },
  { pattern: /\b(?:Vienna|Erste\s*Bank|Stadthalle)\b/i,               surface: 'Indoor' },
  { pattern: /\b(?:Rotterdam|ABN\s*Amro)\b/i,                          surface: 'Indoor' },
  { pattern: /\b(?:Marseille|Open\s*13|Provence)\b/i,                  surface: 'Indoor' },
  { pattern: /\b(?:Metz|Moselle)\b/i,                                   surface: 'Indoor' },
  { pattern: /\b(?:Stockholm)\b/i,                                      surface: 'Indoor' },
  { pattern: /\b(?:Sofia|Sofia\s*Open)\b/i,                             surface: 'Indoor' },
  { pattern: /\b(?:St\.?\s*Petersburg|St\s*Petersburg)\b/i,           surface: 'Indoor' },
  { pattern: /\b(?:Moscow|Kremlin\s*Cup)\b/i,                          surface: 'Indoor' },
  { pattern: /\b(?:Montpellier|Open\s*Sud)\b/i,                        surface: 'Indoor' },
  { pattern: /\bIndoor\b/i,                                            surface: 'Indoor' },

  // Hardcourt — catch-all remaining hard-court events
  { pattern: /\b(?:Australian\s*Open|AO)\b/i,                          surface: 'Hardcourt' },
  { pattern: /\b(?:US\s*Open|Flushing)\b/i,                            surface: 'Hardcourt' },
  { pattern: /\b(?:Indian\s*Wells|BNP\s*Paribas|Tennis\s*Garden)\b/i, surface: 'Hardcourt' },
  { pattern: /\b(?:Miami\s*Open|Miami\s*Masters?)\b/i,                 surface: 'Hardcourt' },
  { pattern: /\b(?:Cincinnati|Western\s*&?\s*Southern)\b/i,            surface: 'Hardcourt' },
  { pattern: /\b(?:Canada(?:ian)?\s*Open|Rogers\s*Cup|National\s*Bank|Toronto|Montreal)\b/i, surface: 'Hardcourt' },
  { pattern: /\b(?:Shanghai|Rolex\s*Shanghai)\b/i,                    surface: 'Hardcourt' },
  { pattern: /\b(?:Beijing|China\s*Open)\b/i,                          surface: 'Hardcourt' },
  { pattern: /\b(?:Tokyo|Japan\s*Open|Rakuten)\b/i,                    surface: 'Hardcourt' },
  { pattern: /\b(?:Washington|Citi\s*Open|Legg\s*Mason)\b/i,           surface: 'Hardcourt' },
  { pattern: /\b(?:Acapulco|Mexican\s*Open|Abierto)\b/i,               surface: 'Hardcourt' },
  { pattern: /\b(?:Dubai|Dubai\s*Tennis)\b/i,                          surface: 'Hardcourt' },
  { pattern: /\b(?:Doha|Qatar\s*Open|ExxonMobil)\b/i,                  surface: 'Hardcourt' },
  { pattern: /\b(?:Adelaide|Adelaide\s*International)\b/i,             surface: 'Hardcourt' },
  { pattern: /\b(?:Brisbane|Brisbane\s*International)\b/i,            surface: 'Hardcourt' },
  { pattern: /\b(?:Sydney\s*International|Sydney\s*Tennis)\b/i,       surface: 'Hardcourt' },
  { pattern: /\b(?:Auckland|ASB\s*Classic)\b/i,                        surface: 'Hardcourt' },
  { pattern: /\b(?:Delray\s*Beach)\b/i,                                surface: 'Hardcourt' },
  { pattern: /\b(?:Los\s*Cabos)\b/i,                                   surface: 'Hardcourt' },
  { pattern: /\b(?:Winston-Salem)\b/i,                                  surface: 'Hardcourt' },
  { pattern: /\b(?:Chengdu)\b/i,                                        surface: 'Hardcourt' },
  { pattern: /\b(?:Zhuhai)\b/i,                                         surface: 'Hardcourt' },
  { pattern: /\b(?:Astana|Almaty|Nur-Sultan)\b/i,                     surface: 'Hardcourt' },
  { pattern: /\b(?:Florence|Firenze)\b/i,                               surface: 'Hardcourt' },
  { pattern: /\b(?:Gijon|Gijón)\b/i,                                    surface: 'Hardcourt' },
  { pattern: /\b(?:Tel\s*Aviv|Tel\s*Aviv\s*Watergen)\b/i,             surface: 'Hardcourt' },
  { pattern: /\b(?:Seoul|Korea\s*Open)\b/i,                            surface: 'Hardcourt' },
  { pattern: /\b(?:Hangzhou)\b/i,                                       surface: 'Hardcourt' },
  { pattern: /\b(?:Hard(?:court)?)\b/i,                                surface: 'Hardcourt' },
];

// ---------------------------------------------------------------------------
// Match-level detection
// ---------------------------------------------------------------------------

/** @type {Array<{pattern: RegExp, level: string}>} */
const LEVEL_PATTERNS = [
  // Grand Slams
  { pattern: /\b(?:Australian\s*Open|French\s*Open|Roland\s*Garros|Wimbledon|US\s*Open)\b/i, level: 'Grand Slam' },

  // ATP Finals
  { pattern: /\b(?:ATP\s*(?:World\s*)?Tour\s*Finals?|Nitto\s*ATP\s*Finals?|Tour\s*Finals?)\b/i, level: 'ATP Finals' },

  // Masters 1000
  { pattern: /\b(?:Indian\s*Wells|Miami\s*(?:Open)?|Monte\s*Carlo|Madrid\s*(?:Open)?|Rome|Italian\s*Open|Canada(?:ian)?\s*Open|Rogers\s*Cup|Cincinnati|Shanghai|Paris\s*(?:Masters?|Bercy|Rolex))\b/i, level: 'Masters' },

  // ATP 500
  { pattern: /\b(?:Rotterdam|Rio\s*(?:Open|de\s*Janeiro)|Acapulco|Mexican\s*Open|Dubai|Barcelona|Halle|Queen['']s|Hamburg|Washington|Beijing|Tokyo|Basel|Vienna)\b/i, level: 'ATP 500' },

  // ATP 250 literal
  { pattern: /\bATP\s*250\b/i,                                         level: 'ATP 250' },

  // Challenger
  { pattern: /\bChallenger\b/i,                                        level: 'Challenger' },

  // ITF Futures / World Tennis Tour / M-level events
  { pattern: /\b(?:M15|M25|ITF|Futures|World\s*Tennis\s*Tour)\b/i,    level: 'ITF Futures' },

  // Fallback: mentions Open/International/Cup/Trophy -> ATP 250
  { pattern: /\b(?:Open|International|Cup|Trophy)\b/i,                 level: 'ATP 250' },
];

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Guess the playing surface from a tournament name.
 * @param {string} tournament - Tournament name to classify.
 * @returns {string|null} Surface name (Clay, Grass, Hardcourt, Indoor, Carpet) or null if unknown.
 */
function guessSurfaceFromTournament(tournament) {
  if (!tournament || typeof tournament !== 'string') return null;
  for (const { pattern, surface } of SURFACE_PATTERNS) {
    if (pattern.test(tournament)) return surface;
  }
  return null;
}

/**
 * Guess the match / tournament level.
 * @param {string} tournament - Tournament name to classify.
 * @returns {string|null} Level string (Grand Slam, ATP Finals, Masters, ATP 500, ATP 250,
 *   Challenger, ITF Futures) or null if unknown.
 */
function guessMatchLevel(tournament) {
  if (!tournament || typeof tournament !== 'string') return null;
  for (const { pattern, level } of LEVEL_PATTERNS) {
    if (pattern.test(tournament)) return level;
  }
  return null;
}

// ---------------------------------------------------------------------------
// News-fetching helper
// ---------------------------------------------------------------------------

/**
 * Build a Google News RSS search URL for a tennis matchup query.
 * @param {string} player1
 * @param {string} player2
 * @returns {string}
 */
function buildMatchupNewsUrl(player1, player2) {
  const q = `tennis ${encodeURIComponent(player1)} vs ${encodeURIComponent(player2)}`;
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Parse a Google News RSS XML blob into a flat array of { title, link, pubDate, source }.
 * Returns an empty array on any parse failure (graceful degradation).
 * @param {string} xml
 * @returns {Array<{title: string, link: string, pubDate: string, source: string}>}
 */
function parseRss(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    let source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
    items.push({
      title: stripCdata(rawTitle).trim(),
      link: link.trim(),
      pubDate: pubDate.trim(),
      source: stripCdata(source).trim()
    });
  }
  return items;
}

/**
 * Strip CDATA wrapper from a string.
 * @param {*} s
 * @returns {string}
 */
function stripCdata(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Fetch Google News RSS results for player1 vs player2.
 * @param {string} player1
 * @param {string} player2
 * @returns {Promise<Array<{title: string, link: string, pubDate: string, source: string}>>}
 */
async function fetchMatchupNews(player1, player2) {
  try {
    const url = buildMatchupNewsUrl(player1, player2);
    const { stdout } = await pExecFile('curl', ['-sL', '--max-time', String(CURL_TIMEOUT_MS / 1000), url], {
      timeout: CURL_TIMEOUT_MS
    });
    return parseRss(stdout);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Get tennis context for a match: surface, level, and optional matchup news count.
 *
 * @param {Object} opts
 * @param {string} [opts.player1] - Name of the first player.
 * @param {string} [opts.player2] - Name of the second player.
 * @param {string} [opts.tournament] - Tournament name (used for surface/level detection).
 * @param {string} [opts.surface] - Explicit surface override (skips tournament guessing).
 * @returns {Promise<{
 *   ok: boolean,
 *   sport: string,
 *   surface: string|null,
 *   level: string|null,
 *   matchupNewsCount: number,
 *   riskFlag: string,
 *   riskSummary: string|null,
 *   signals: { surface: string|null, level: string|null, matchupArticles: boolean },
 *   cached: boolean,
 *   fetchedAt: string
 * }>}
 */
async function getTennisContext(opts = {}) {
  const { player1, player2, tournament, surface: explicitSurface } = opts;

  // Guess surface & level from tournament (or use explicit surface)
  let surface = explicitSurface || (tournament ? guessSurfaceFromTournament(tournament) : null);
  const level = tournament ? guessMatchLevel(tournament) : null;

  // Determine risk state
  let riskFlag = 'clean';
  let riskSummary = null;

  if (!surface) {
    surface = 'unknown';
    riskFlag = 'unknown';
    riskSummary = 'Could not determine playing surface from tournament name';
  }

  if (!level) {
    riskSummary = riskSummary
      ? `${riskSummary}; could not determine match level`
      : 'Could not determine match level';
    if (riskFlag === 'clean') riskFlag = 'unknown';
  }

  // Optionally fetch matchup news
  let matchupNewsCount = 0;
  let matchupArticles = false;

  if (player1 && player2) {
    const articles = await fetchMatchupNews(player1, player2);
    matchupNewsCount = articles.length;
    matchupArticles = matchupNewsCount > 0;
  }

  return {
    ok: true,
    sport: 'Tennis',
    surface,
    level,
    matchupNewsCount,
    riskFlag,
    riskSummary,
    signals: {
      surface,
      level,
      matchupArticles
    },
    cached: false,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  getTennisContext,
  guessSurfaceFromTournament,
  guessMatchLevel,
  buildMatchupNewsUrl,
  parseRss,
  stripCdata,
  SURFACE_PATTERNS,
  LEVEL_PATTERNS
};
