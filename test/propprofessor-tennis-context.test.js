'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');

// RSS fixture — 2 tennis articles about a matchup
const TENNIS_NEWS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Tennis News</title>
<item>
  <title><![CDATA[Alcaraz vs Sinner: Preview and prediction - Tennis Channel]]></title>
  <link>https://www.tennis.com/alcaraz-sinner-preview</link>
  <pubDate>Sun, 21 Jun 2026 10:00:00 GMT</pubDate>
  <source url="https://www.tennis.com">Tennis Channel</source>
</item>
<item>
  <title>Alcaraz beats Sinner in 5-set thriller at Roland Garros</title>
  <link>https://www.espn.com/tennis/story/_/id/12345</link>
  <pubDate>Sun, 21 Jun 2026 12:30:00 GMT</pubDate>
  <source>ESPN</source>
</item>
</channel></rss>`;

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;

let originalExecFile = null;

function mockCurlSuccess(stdout) {
  cp.execFile = (file, args, arg3, arg4) => {
    const cb = typeof arg3 === 'function' ? arg3 : arg4;
    cb(null, stdout, '');
  };
}

function mockCurlFailure(errMsg) {
  cp.execFile = (file, args, arg3, arg4) => {
    const cb = typeof arg3 === 'function' ? arg3 : arg4;
    cb(new Error(errMsg));
  };
}

function clearModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('propprofessor-tennis-context')) {
      delete require.cache[key];
    }
  }
}

before(() => {
  originalExecFile = cp.execFile;
});

after(() => {
  cp.execFile = originalExecFile;
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('module exports', () => {
  it('exports getTennisContext, guessSurfaceFromTournament, guessMatchLevel', () => {
    const mod = require('../lib/propprofessor-tennis-context');
    assert.equal(typeof mod.getTennisContext, 'function');
    assert.equal(typeof mod.guessSurfaceFromTournament, 'function');
    assert.equal(typeof mod.guessMatchLevel, 'function');
  });
});

// ---------------------------------------------------------------------------
// guessSurfaceFromTournament
// ---------------------------------------------------------------------------

describe('guessSurfaceFromTournament', () => {
  beforeEach(() => clearModuleCache());

  it('returns null for empty / non-string input', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament(), null);
    assert.equal(guessSurfaceFromTournament(null), null);
    assert.equal(guessSurfaceFromTournament(''), null);
    assert.equal(guessSurfaceFromTournament(42), null);
  });

  // -- Clay --
  it('detects Roland Garros / French Open as Clay', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Roland Garros'), 'Clay');
    assert.equal(guessSurfaceFromTournament('French Open'), 'Clay');
  });

  it('detects Monte Carlo as Clay', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Monte Carlo Masters'), 'Clay');
  });

  it('detects Madrid Open as Clay', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Mutua Madrid Open'), 'Clay');
  });

  it('detects Italian Open as Clay', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Italian Open'), 'Clay');
  });

  it('detects generic Clay mention', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Some Clay Tournament'), 'Clay');
  });

  // -- Grass --
  it('detects Wimbledon as Grass', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Wimbledon'), 'Grass');
  });

  it("detects Queen's Club as Grass", () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament("Queen's Club Championships"), 'Grass');
  });

  it('detects Halle as Grass', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Halle Open'), 'Grass');
  });

  it('detects generic Grass mention', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Grass Court Championships'), 'Grass');
  });

  // -- Hardcourt --
  it('detects Australian Open as Hardcourt', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Australian Open'), 'Hardcourt');
  });

  it('detects US Open as Hardcourt', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('US Open'), 'Hardcourt');
  });

  it('detects Indian Wells as Hardcourt', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Indian Wells Masters'), 'Hardcourt');
  });

  it('detects Miami Open as Hardcourt', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Miami Open'), 'Hardcourt');
  });

  it('detects generic Hardcourt mention', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Hardcourt Championship'), 'Hardcourt');
  });

  // -- Indoor --
  it('detects Paris Masters as Indoor', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Rolex Paris Masters'), 'Indoor');
  });

  it('detects Basel as Indoor', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Swiss Indoors Basel'), 'Indoor');
  });

  it('detects generic Indoor mention', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Indoor Championships'), 'Indoor');
  });

  // -- Unknown --
  it('returns null for unrecognised tournament', () => {
    const { guessSurfaceFromTournament } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessSurfaceFromTournament('Mystery Cup 2026'), null);
  });
});

// ---------------------------------------------------------------------------
// guessMatchLevel
// ---------------------------------------------------------------------------

describe('guessMatchLevel', () => {
  beforeEach(() => clearModuleCache());

  it('returns null for empty / non-string input', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel(), null);
    assert.equal(guessMatchLevel(null), null);
    assert.equal(guessMatchLevel(''), null);
  });

  it('detects Grand Slams', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Australian Open'), 'Grand Slam');
    assert.equal(guessMatchLevel('French Open'), 'Grand Slam');
    assert.equal(guessMatchLevel('Roland Garros'), 'Grand Slam');
    assert.equal(guessMatchLevel('Wimbledon'), 'Grand Slam');
    assert.equal(guessMatchLevel('US Open'), 'Grand Slam');
  });

  it('detects Masters 1000', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Indian Wells Masters'), 'Masters');
    assert.equal(guessMatchLevel('Miami Open'), 'Masters');
    assert.equal(guessMatchLevel('Monte Carlo Masters'), 'Masters');
    assert.equal(guessMatchLevel('Madrid Open'), 'Masters');
    assert.equal(guessMatchLevel('Italian Open Rome'), 'Masters');
    assert.equal(guessMatchLevel('Rogers Cup'), 'Masters');
    assert.equal(guessMatchLevel('Rolex Paris Masters'), 'Masters');
  });

  it('detects ATP 500', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Rotterdam Open'), 'ATP 500');
    assert.equal(guessMatchLevel('Rio Open'), 'ATP 500');
    assert.equal(guessMatchLevel('Dubai Tennis Championships'), 'ATP 500');
    assert.equal(guessMatchLevel('Barcelona Open'), 'ATP 500');
    assert.equal(guessMatchLevel("Queen's Club Championships"), 'ATP 500');
    assert.equal(guessMatchLevel('Halle Open'), 'ATP 500');
    assert.equal(guessMatchLevel('Hamburg Open'), 'ATP 500');
    assert.equal(guessMatchLevel('Citi Open Washington'), 'ATP 500');
    assert.equal(guessMatchLevel('Swiss Indoors Basel'), 'ATP 500');
    assert.equal(guessMatchLevel('Erste Bank Open Vienna'), 'ATP 500');
  });

  it('detects literal "ATP 250" mention', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('ATP 250 Event'), 'ATP 250');
  });

  it('detects Challenger', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Prague Challenger'), 'Challenger');
  });

  it('detects ITF Futures', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('M15 Monastir'), 'ITF Futures');
    assert.equal(guessMatchLevel('ITF World Tennis Tour M25'), 'ITF Futures');
    assert.equal(guessMatchLevel('Futures USA F15'), 'ITF Futures');
  });

  it('defaults Open/International/Cup to ATP 250', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Mystery Open'), 'ATP 250');
    assert.equal(guessMatchLevel('Some International'), 'ATP 250');
    assert.equal(guessMatchLevel('Random Cup'), 'ATP 250');
  });

  it('returns null for unrecognised tournament', () => {
    const { guessMatchLevel } = require('../lib/propprofessor-tennis-context');
    assert.equal(guessMatchLevel('Random Friendly Match'), null);
  });
});

// ---------------------------------------------------------------------------
// getTennisContext
// ---------------------------------------------------------------------------

describe('getTennisContext', () => {
  beforeEach(() => clearModuleCache());

  it('returns unknown surface and null level for empty params', async () => {
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({});
    assert.equal(result.ok, true);
    assert.equal(result.sport, 'Tennis');
    assert.equal(result.surface, 'unknown');
    assert.equal(result.level, null);
    assert.equal(result.matchupNewsCount, 0);
    assert.equal(result.riskFlag, 'unknown');
    assert.ok(result.riskSummary);
    assert.equal(result.signals.surface, 'unknown');
    assert.equal(result.signals.level, null);
    assert.equal(result.signals.matchupArticles, false);
    assert.equal(result.cached, false);
    assert.ok(result.fetchedAt);
  });

  it('guesses surface and level from tournament name', async () => {
    mockCurlSuccess(EMPTY_RSS);
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({
      player1: 'Carlos Alcaraz',
      player2: 'Jannik Sinner',
      tournament: 'Roland Garros'
    });
    assert.equal(result.surface, 'Clay');
    assert.equal(result.level, 'Grand Slam');
    assert.equal(result.riskFlag, 'clean');
    assert.equal(result.riskSummary, null);
    assert.equal(result.signals.surface, 'Clay');
    assert.equal(result.signals.level, 'Grand Slam');
  });

  it('uses explicit surface override', async () => {
    mockCurlSuccess(EMPTY_RSS);
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({
      tournament: 'Wimbledon',
      surface: 'Grass'
    });
    assert.equal(result.surface, 'Grass');
  });

  it('reports riskFlag unknown when surface cannot be determined', async () => {
    mockCurlSuccess(EMPTY_RSS);
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({ tournament: 'Unknown Event 2026' });
    assert.equal(result.surface, 'unknown');
    assert.equal(result.riskFlag, 'unknown');
    assert.ok(result.riskSummary.includes('surface'));
  });

  it('fetches matchup news when player1 and player2 are provided', async () => {
    mockCurlSuccess(TENNIS_NEWS_FIXTURE);
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({
      player1: 'Carlos Alcaraz',
      player2: 'Jannik Sinner',
      tournament: 'Roland Garros'
    });
    assert.equal(result.matchupNewsCount, 2);
    assert.equal(result.signals.matchupArticles, true);
  });

  it('returns 0 matchupNewsCount when news fetch fails', async () => {
    mockCurlFailure('Network error');
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({
      player1: 'Carlos Alcaraz',
      player2: 'Jannik Sinner',
      tournament: 'Wimbledon'
    });
    assert.equal(result.matchupNewsCount, 0);
    assert.equal(result.signals.matchupArticles, false);
    assert.equal(result.surface, 'Grass');
    assert.equal(result.level, 'Grand Slam');
  });

  it('returns sport: Tennis in all cases', async () => {
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({});
    assert.equal(result.sport, 'Tennis');
  });

  it('has fetchedAt as valid ISO string', async () => {
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({});
    assert.equal(typeof result.fetchedAt, 'string');
    assert.ok(result.fetchedAt.length > 0);
    assert.ok(!isNaN(Date.parse(result.fetchedAt)));
  });

  it('sets cached to false', async () => {
    const { getTennisContext } = require('../lib/propprofessor-tennis-context');
    const result = await getTennisContext({});
    assert.equal(result.cached, false);
  });
});
