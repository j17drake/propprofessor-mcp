'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');
const { createPropProfessorClient } = require('./propprofessor-api');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');

const DEFAULT_PORT = 3477;
const DEFAULT_REFRESH_SECONDS = 60;
const DEFAULT_BOOK = 'Fliff';
const DEFAULT_TARGET_BOOKS = ['Fliff', 'NoVigApp'];
const DEFAULT_RESEARCH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const DEFAULT_RESEARCH_DIR = path.join(DEFAULT_HERMES_HOME, 'propprofessor', 'sharp-play-research');
const DEFAULT_RESEARCH_STATE_PATH = path.join(DEFAULT_RESEARCH_DIR, 'queue.json');
const DEFAULT_DECISION_STATE_PATH = path.join(DEFAULT_RESEARCH_DIR, 'decisions.json');
const DEFAULT_HERMES_ENV_PATH = path.join(DEFAULT_HERMES_HOME, '.env');
const RESEARCH_WEB_CONFIG_HOME = path.join(DEFAULT_RESEARCH_DIR, 'hermes-tavily-home');
const RESEARCH_WEB_CONFIG_PATH = path.join(RESEARCH_WEB_CONFIG_HOME, 'config.yaml');
const DEFAULT_LEAGUES = ['NBA', 'MLB', 'NHL', 'Tennis', 'WNBA'];
const DEFAULT_MARKETS = ['Moneyline'];
const TARGET_BOOK_OPTIONS = [
  { value: 'Fliff', label: 'Fliff' },
  { value: 'NoVigApp', label: 'NoVig' }
];
const LEAGUE_OPTIONS = [
  { value: 'all', label: 'All leagues', leagues: DEFAULT_LEAGUES },
  { value: 'NBA', label: 'NBA' },
  { value: 'MLB', label: 'MLB' },
  { value: 'NHL', label: 'NHL' },
  { value: 'Tennis', label: 'Tennis' },
  { value: 'WNBA', label: 'WNBA' }
];
const MARKET_OPTIONS = [
  { value: 'Moneyline', label: 'Moneyline' },
  { value: 'Spread', label: 'Spread' },
  { value: 'Total', label: 'Total' },
  { value: 'all', label: 'All main markets', markets: ['Moneyline', 'Spread', 'Total'] }
];

let lastSnapshot = null;
let lastRefreshPromises = new Map();
let lastSnapshotByFilters = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCsv(value, fallback = []) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : [...fallback];
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBookName(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BOOK;
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact === 'novig' || compact === 'novigapp' || compact === 'novigapps') return 'NoVigApp';
  if (compact === 'fliff') return 'Fliff';
  if (compact === 'rebet') return 'Rebet';
  return raw;
}

function normalizeTargetBookList(value, fallback = DEFAULT_TARGET_BOOKS) {
  const rawItems = Array.isArray(value) ? value : parseCsv(value, fallback);
  const seen = new Set();
  const books = [];
  for (const raw of rawItems) {
    const normalized = normalizeBookName(raw);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    books.push(normalized);
  }
  return books.length ? books : [...fallback];
}

function normalizeLeagueList(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return [...DEFAULT_LEAGUES];
  const items = parseCsv(raw, DEFAULT_LEAGUES);
  if (items.some((item) => item.toLowerCase() === 'all')) return [...DEFAULT_LEAGUES];
  return items;
}

function normalizeMarketList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [...DEFAULT_MARKETS];
  if (raw.toLowerCase() === 'all') return ['Moneyline', 'Spread', 'Total'];
  const items = parseCsv(raw, DEFAULT_MARKETS);
  if (items.some((item) => item.toLowerCase() === 'all')) return ['Moneyline', 'Spread', 'Total'];
  return items;
}

function getSelectedLeagueValue(leagues = []) {
  const list = Array.isArray(leagues) ? leagues : [];
  if (list.length === DEFAULT_LEAGUES.length && DEFAULT_LEAGUES.every((league) => list.includes(league))) return 'all';
  return list.length === 1 ? list[0] : 'all';
}

function getSelectedMarketValue(markets = []) {
  const list = Array.isArray(markets) ? markets : [];
  const allMain = ['Moneyline', 'Spread', 'Total'];
  if (list.length === allMain.length && allMain.every((market) => list.includes(market))) return 'all';
  return list.length === 1 ? list[0] : 'all';
}

function getParamValue(params, key, { last = false } = {}) {
  if (!params) return undefined;
  if (typeof params.getAll === 'function') {
    const values = params.getAll(key).filter((value) => value !== undefined && value !== null && value !== '');
    if (values.length) return last ? values.at(-1) : values[0];
  }
  return typeof params.get === 'function' ? params.get(key) : params[key];
}

function getBooleanParam(params, key, fallback = false) {
  const value = getParamValue(params, key, { last: true });
  return parseBoolean(value, fallback);
}

function renderOptions(options, selectedValue) {
  return options
    .map((option) => {
      const selected = option.value === selectedValue ? ' selected' : '';
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join('');
}

function normalizeDashboardFilters(input = {}) {
  const params = input instanceof URL ? input.searchParams : input;
  const get = (key, options) => getParamValue(params, key, options);
  const leaguesPreset = get('leagues', { last: true });
  const leaguesCsv = get('leaguesCsv', { last: true });
  const marketsPreset = get('markets', { last: true });
  const marketsCsv = get('marketsCsv', { last: true });
  const targetBooksRepeated = typeof params.getAll === 'function' ? params.getAll('targetBooks').filter(Boolean) : [];
  const targetBooksCsv = get('targetBooksCsv', { last: true }) || get('target-books-csv', { last: true });
  const legacyBook = get('book') || DEFAULT_BOOK;
  const targetBooks = targetBooksRepeated.length
    ? normalizeTargetBookList(targetBooksRepeated)
    : targetBooksCsv
      ? normalizeTargetBookList(targetBooksCsv)
      : get('book')
        ? normalizeTargetBookList([legacyBook], [normalizeBookName(legacyBook)])
        : [...DEFAULT_TARGET_BOOKS];
  return {
    book: targetBooks[0] || normalizeBookName(legacyBook),
    targetBooks,
    leagues: leaguesPreset === 'all' && leaguesCsv ? normalizeLeagueList(leaguesCsv) : normalizeLeagueList(leaguesPreset),
    markets: marketsPreset === 'all' && marketsCsv ? normalizeMarketList(marketsCsv) : normalizeMarketList(marketsPreset || get('market', { last: true })),
    limit: parseNumber(get('limit'), 10),
    scanLimit: parseNumber(get('scanLimit') || get('scan-limit'), 30),
    minOdds: parseNumber(get('minOdds') || get('min-odds'), undefined),
    maxOdds: parseNumber(get('maxOdds') || get('max-odds'), undefined),
    minConsensusBookCount: parseNumber(get('minConsensusBookCount') || get('min-consensus-book-count'), 2),
    lookbackHours: parseNumber(get('lookbackHours') || get('lookback-hours'), 6),
    maxAgeMs: parseNumber(get('maxAgeMs') || get('max-age-ms'), undefined),
    timeWindow: String(get('timeWindow') || 'all').toLowerCase(),
    hidePlaced: getBooleanParam(params, 'hidePlaced', true),
    hideHidden: getBooleanParam(params, 'hideHidden', true),
    unresearchedOnly: getBooleanParam(params, 'unresearchedOnly', false),
    strongSupportOnly: getBooleanParam(params, 'strongSupportOnly', false),
    plusMoneyOnly: getBooleanParam(params, 'plusMoneyOnly', false),
    strict: !getBooleanParam(params, 'broad', false),
    includePasses: getBooleanParam(params, 'includePasses', getBooleanParam(params, 'include-passes', false)),
    allowRecentOnly: getBooleanParam(params, 'allowRecentOnly', getBooleanParam(params, 'allow-recent-only', false)),
    debug: getBooleanParam(params, 'debug', false),
    is_live: getBooleanParam(params, 'live', getBooleanParam(params, 'is_live', false))
  };
}

function formatOdds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'n/a';
  return number > 0 ? `+${number}` : String(number);
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '0.0';
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractStartTime(play = {}) {
  const candidates = [
    play.startTime,
    play.start_time,
    play.startTs,
    play.start_ts,
    play.commenceTime,
    play.commence_time,
    play.gameStartTime,
    play.eventStartTime,
    play?.game?.startTime,
    play?.event?.startTime,
    play?.raw?.startTime
  ];
  for (const candidate of candidates) {
    const date = toDate(candidate);
    if (date) return candidate;
  }
  return null;
}

function formatStartTime(value, options = {}) {
  const date = toDate(value);
  if (!date) return 'Start time unavailable';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: options.timeZone
  });
}

function formatTimeUntil(value, options = {}) {
  const date = toDate(value);
  if (!date) return 'Start time unavailable';
  const now = toDate(options.now) || new Date();
  const deltaMs = date.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(deltaMs) / 60000);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || !parts.length) parts.push(`${minutes}m`);
  return deltaMs >= 0 ? `starts in ${parts.join(' ')}` : `started ${parts.join(' ')} ago`;
}

function isTennisPlay(play = {}) {
  const league = String(play.scanLeague || play.league || play.leaguePreset || '').toLowerCase();
  return league === 'tennis';
}

function parseResearchVerdict(summary = '') {
  const text = String(summary || '');
  const verdict = text.match(/Verdict:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const playablePrice = text.match(/Playable price:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const confidence = text.match(/Confidence:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const action = text.match(/Action:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const evidenceChecked = text.match(/Evidence checked:\s*([\s\S]*?)(?:\n[A-Z][A-Za-z ]+:|$)/i)?.[1]?.trim() || '';
  const directTargetBookVerified = /\b(target[- ]book|current target-book price|target book price)\b/i.test(evidenceChecked)
    && !/\b(indirect|not directly verified|not verified|unverified|search snippet)\b/i.test(evidenceChecked);
  return { verdict, playablePrice, confidence, action, directTargetBookVerified, evidenceChecked };
}

function getResearchRiskFlags(summary = '') {
  const isText = typeof summary === 'string';
  const play = isText ? {} : (summary?.play || summary || {});
  const parsed = isText ? parseResearchVerdict(summary) : parseResearchVerdict(summary?.summary || '');
  const text = isText ? summary : String(summary?.summary || '');
  const matchup = text.match(/Matchup analysis:\s*([\s\S]*?)(?:\n[A-Z][A-Za-z ]+:|$)/i)?.[1]?.trim() || '';
  const flags = [];
  if ((parsed.verdict || '').toLowerCase().includes('bet') && (!parsed.directTargetBookVerified || /\b(indirect|not directly verified|not verified|unverified|search snippet)\b/i.test(parsed.evidenceChecked || ''))) {
    flags.push('indirect-target-book-only');
  }
  if (/confidence:\s*low/i.test(text) || String(parsed.confidence || '').toLowerCase() === 'low') flags.push('low-confidence');
  if (!matchup || /^(none|n\/a|not checked|not verified|missing)$/i.test(matchup)) flags.push('no-matchup-analysis');
  if (isTennisPlay(play) && /\b(stale|started|finished|already live)\b/i.test(text) && !/\b(Flashscore|Sofascore|WTA|ATP|official tournament|target-book odds are gone|target book odds are gone)\b/i.test(text)) flags.push('stale-time-only-tennis');
  if (!parsed.playablePrice || /n\/a/i.test(parsed.playablePrice)) flags.push('missing-playable-price');
  return flags;
}

function parseAmericanOdds(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(normalized) ? normalized : null;
}

function getPriceStatus(play = {}, researchEntry = null) {
  const research = parseResearchVerdict(researchEntry?.summary || '');
  const playableRaw = research.playablePrice || play.playablePrice || play.targetPrice || '';
  const currentRaw = play.odds ?? play.currentOdds ?? play.price;
  const currentOdds = parseAmericanOdds(currentRaw);
  const playableOdds = parseAmericanOdds(playableRaw);

  if (currentOdds === null) {
    return {
      status: 'Missing',
      currentOdds: null,
      playablePrice: playableRaw || '',
      playableOdds
    };
  }

  if (playableOdds === null) {
    return {
      status: 'Verify',
      currentOdds,
      playablePrice: playableRaw || '',
      playableOdds: null
    };
  }

  return {
    status: currentOdds >= playableOdds ? 'Playable' : 'Too expensive',
    currentOdds,
    playablePrice: playableRaw || '',
    playableOdds
  };
}

function getMovementNote(play = {}, verdict = {}) {
  const label = String(play.movementLabel || play.movement || verdict.movementLabel || '').toLowerCase();
  const source = String(play.movementSourceBook || verdict.movementSourceBook || '').trim();
  const sourceText = source ? ` from ${source}` : '';
  if (!label || label === 'unknown' || label === 'none') return `No clear movement signal${sourceText}.`;
  if (label.includes('support')) return `Supportive movement${sourceText}.`;
  if (label.includes('adverse')) return `Adverse movement${sourceText}.`;
  if (label.includes('mixed')) return `Mixed movement${sourceText}.`;
  if (label.includes('recent')) return `Recent movement${sourceText}.`;
  return `${label.charAt(0).toUpperCase() + label.slice(1)} movement${sourceText}.`;
}

function getResearchCounts(entries = []) {
  const counts = { queued: 0, researching: 0, done: 0, failed: 0, total: 0 };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const status = String(entry?.status || '').toLowerCase();
    if (status in counts) counts[status] += 1;
    counts.total += 1;
  }
  return counts;
}

function getPlayActionVerdict(play = {}, researchEntry = null, decisionEntry = null) {
  const research = parseResearchVerdict(researchEntry?.summary || '');
  const decision = String(decisionEntry?.status || '').toLowerCase();
  const rawLabel = String(play.verdict || research.verdict || '').toLowerCase();
  const priceStatus = getPriceStatus(play, researchEntry);
  let label = 'Research first';
  if (decision === 'placed') label = 'Bet placed';
  else if (decision === 'hidden') label = 'Hidden';
  else if (decision === 'passed') label = 'Pass';
  else if (decision === 'watch') label = 'Watch price';
  else if (priceStatus.status === 'Missing') label = 'Missing';
  else if (priceStatus.status === 'Verify') label = 'Verify';
  else if (priceStatus.status === 'Too expensive') label = 'Too expensive';
  else if (priceStatus.status === 'Playable' && (rawLabel.includes('bet') || rawLabel.includes('lean'))) label = research.directTargetBookVerified ? 'Bet' : 'Verify';
  else if (rawLabel.includes('pass')) label = 'Pass';
  else if (rawLabel.includes('watch') || rawLabel.includes('lean')) label = 'Watch price';
  else if (priceStatus.status === 'Playable') label = research.directTargetBookVerified ? 'Bet' : 'Verify';
  const movementLabel = play.movementLabel || play.movement || 'unknown';
  return {
    label,
    verdict: research.verdict || play.verdict || '',
    playablePrice: priceStatus.playablePrice || research.playablePrice || '',
    priceStatus: priceStatus.status,
    movementLabel,
    decisionStatus: decisionEntry?.status || '',
    reason: research.action || play.note || '',
    directTargetBookVerified: Boolean(research.directTargetBookVerified),
    evidenceChecked: research.evidenceChecked || ''
  };
}

function labelClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('bet')) return 'good';
  if (normalized.includes('lean')) return 'warn';
  if (normalized.includes('pass')) return 'bad';
  if (normalized.includes('supportive')) return 'good';
  if (normalized.includes('adverse')) return 'bad';
  if (normalized.includes('mixed') || normalized.includes('recent')) return 'warn';
  return 'neutral';
}

function buildQueryString(filters = {}, overrides = {}) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  const targetBooks = normalizeTargetBookList(merged.targetBooks || merged.targetBooksCsv || merged.book || DEFAULT_TARGET_BOOKS);
  params.set('book', targetBooks[0] || merged.book || DEFAULT_BOOK);
  params.set('targetBooksCsv', targetBooks.join(','));
  params.set('leagues', (merged.leagues || DEFAULT_LEAGUES).join(','));
  params.set('markets', (merged.markets || DEFAULT_MARKETS).join(','));
  params.set('limit', String(merged.limit || 10));
  params.set('scanLimit', String(merged.scanLimit || 30));
  params.set('minConsensusBookCount', String(merged.minConsensusBookCount || 2));
  params.set('lookbackHours', String(merged.lookbackHours || 6));
  if (merged.minOdds !== undefined) params.set('minOdds', String(merged.minOdds));
  if (merged.maxOdds !== undefined) params.set('maxOdds', String(merged.maxOdds));
  if (merged.maxAgeMs !== undefined) params.set('maxAgeMs', String(merged.maxAgeMs));
  if (merged.timeWindow) params.set('timeWindow', merged.timeWindow);
  if (!merged.strict) params.set('broad', '1');
  if (merged.includePasses) params.set('includePasses', '1');
  if (merged.allowRecentOnly) params.set('allowRecentOnly', '1');
  params.set('hidePlaced', merged.hidePlaced ? '1' : '0');
  params.set('hideHidden', merged.hideHidden ? '1' : '0');
  if (merged.unresearchedOnly) params.set('unresearchedOnly', '1');
  if (merged.strongSupportOnly) params.set('strongSupportOnly', '1');
  if (merged.plusMoneyOnly) params.set('plusMoneyOnly', '1');
  if (merged.is_live) params.set('live', '1');
  return params.toString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const content = JSON.stringify(value, null, 2);
  fs.writeFileSync(tempPath, `${content}\n`);
  fs.renameSync(tempPath, filePath);
}

function getPlayIdentityPayload(play = {}) {
  return {
    book: play.book || play.sharpPlaySupport?.targetBook || '',
    odds: play.odds ?? play.currentOdds ?? play.price ?? null,
    pick: play.pick || play.selection || play.participant || '',
    game: play.game || play.matchup || [play.awayTeam, play.homeTeam].filter(Boolean).join(' vs ') || play.gameId || '',
    market: play.scanMarket || play.screenMarket || play.market || play.playType || '',
    league: play.scanLeague || play.league || play.leaguePreset || '',
    movementSourceBook: play.movementSourceBook || '',
    movementLabel: play.movementLabel || '',
    consensusBookCount: play.consensusBookCount ?? 0
  };
}

function getPlayResearchId(play = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(getPlayIdentityPayload(play)))
    .digest('hex')
    .slice(0, 16);
}

function cleanResearchSummary(value) {
  let text = String(value || '').replace(/\r/g, '').trim();
  if (!text) return '';

  const verdictMatches = Array.from(text.matchAll(/(^|\n)\s*Verdict:\s*/g));
  if (verdictMatches.length) {
    const last = verdictMatches[verdictMatches.length - 1];
    text = text.slice(last.index + (last[1] || '').length).trimStart();
  }

  text = text
    .replace(/^╭.*$/gm, '')
    .replace(/^╰.*$/gm, '')
    .replace(/^Resume this session with:[\s\S]*$/m, '')
    .replace(/^Session:\s+.*$/gm, '')
    .replace(/^Duration:\s+.*$/gm, '')
    .replace(/^Messages:\s+.*$/gm, '')
    .split('\n')
    .map((line) => line.replace(/^\s*│\s?/, '').replace(/\s*│\s*$/, '').trimEnd())
    .join('\n')
    .trim();

  if (verdictMatches.length && !text.startsWith('Verdict:')) text = `Verdict: ${text}`;
  return text;
}

function readResearchSummary(entry = {}) {
  let summary = String(entry.summary || '');
  if (!/Verdict:\s*/.test(summary) && entry.outputPath) {
    try {
      summary = fs.readFileSync(entry.outputPath, 'utf8');
    } catch {
      // Keep the stored summary if the archived output is unavailable.
    }
  }
  return summary;
}

function isPidAlive(pid) {
  const number = Number(pid);
  if (!Number.isInteger(number) || number <= 0) return false;
  try {
    process.kill(number, 0);
    return true;
  } catch {
    return false;
  }
}

function sanitizeResearchEntry(entry = {}) {
  const rawSummary = readResearchSummary(entry);
  const status = String(entry.status || 'queued');
  const pid = Number.isFinite(Number(entry.pid)) ? Number(entry.pid) : null;
  const completedAt = entry.completedAt || null;
  const exitCode = Number.isFinite(Number(entry.exitCode)) ? Number(entry.exitCode) : null;
  const staleResearching = ['queued', 'researching'].includes(status) && pid && entry.promptPath && !isPidAlive(pid);
  return {
    id: String(entry.id || ''),
    status: staleResearching ? 'failed' : status,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
    completedAt: staleResearching ? new Date().toISOString() : completedAt,
    exitCode,
    error: staleResearching ? `Research process ${pid} is no longer running.` : (entry.error ? String(entry.error).slice(0, 2000) : null),
    summary: rawSummary ? cleanResearchSummary(rawSummary).slice(0, 6000) : '',
    promptPath: entry.promptPath || null,
    outputPath: entry.outputPath || null,
    pid,
    play: entry.play && typeof entry.play === 'object' ? entry.play : null,
    filters: entry.filters && typeof entry.filters === 'object' ? entry.filters : null
  };
}

function sanitizeDecisionEntry(entry = {}) {
  return {
    id: String(entry.id || ''),
    status: String(entry.status || 'cleared'),
    note: entry.note ? String(entry.note).slice(0, 1000) : '',
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
    play: entry.play && typeof entry.play === 'object' ? entry.play : null,
    filters: entry.filters && typeof entry.filters === 'object' ? entry.filters : null
  };
}

function createDecisionStore({ statePath = DEFAULT_DECISION_STATE_PATH } = {}) {
  return {
    statePath,
    readState() {
      const state = readJsonFile(statePath, { items: {} });
      return { items: state && typeof state.items === 'object' ? state.items : {} };
    },
    writeState(state) {
      writeJsonFile(statePath, { items: state.items || {} });
    },
    list() {
      return Object.values(this.readState().items || {})
        .map(sanitizeDecisionEntry)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    },
    get(id) {
      const state = this.readState();
      return state.items[id] ? sanitizeDecisionEntry(state.items[id]) : null;
    },
    set(id, patch = {}) {
      const state = this.readState();
      const previous = sanitizeDecisionEntry(state.items[id] || { id });
      state.items[id] = sanitizeDecisionEntry({ ...previous, ...patch, id, updatedAt: new Date().toISOString() });
      this.writeState(state);
      return state.items[id];
    },
    clear(id) {
      const state = this.readState();
      if (state.items[id]) delete state.items[id];
      this.writeState(state);
      return true;
    }
  };
}

function createResearchQueue({ statePath = process.env.PP_SHARP_PLAYS_RESEARCH_STATE || DEFAULT_RESEARCH_STATE_PATH, runner = null } = {}) {
  const queue = {
    statePath,
    readState() {
      const state = readJsonFile(statePath, { items: {} });
      const items = state && typeof state.items === 'object' ? state.items : {};
      return { items };
    },
    writeState(state) {
      writeJsonFile(statePath, { items: state.items || {} });
    },
    get(id) {
      const state = queue.readState();
      return state.items[id] ? sanitizeResearchEntry(state.items[id]) : null;
    },
    list() {
      return Object.values(queue.readState().items || {})
        .map(sanitizeResearchEntry)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    },
    update(id, patch) {
      const state = queue.readState();
      const previous = sanitizeResearchEntry(state.items[id] || { id });
      state.items[id] = sanitizeResearchEntry({ ...previous, ...patch, id, updatedAt: new Date().toISOString() });
      queue.writeState(state);
      return state.items[id];
    },
    clear(id) {
      const state = queue.readState();
      if (state.items[id]) delete state.items[id];
      queue.writeState(state);
      return true;
    },
    clearFailed() {
      const state = queue.readState();
      for (const [itemId, entry] of Object.entries(state.items || {})) {
        if (String(entry?.status || '').toLowerCase() === 'failed') delete state.items[itemId];
      }
      queue.writeState(state);
      return true;
    },
    requeue(id) {
      const existing = queue.get(id);
      if (!existing) return null;
      return queue.enqueue(existing.play || {}, existing.filters || {});
    },
    enqueue(play, filters = {}) {
      const id = getPlayResearchId(play);
      const existing = queue.get(id);
      if (existing && ['queued', 'researching'].includes(existing.status)) return { entry: existing, started: false, duplicate: true };

      const now = new Date().toISOString();
      const entry = sanitizeResearchEntry({
        id,
        status: 'queued',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        play,
        filters
      });
      queue.update(id, entry);
      queue.run(entry);
      return { entry: queue.get(id), started: true, duplicate: false };
    },
    run(entry) {
      if (typeof runner === 'function') return runner(entry, queue);
      return runResearchAgent(entry, queue);
    }
  };
  return queue;
}

function getDecisionIdForPlay(play = {}) {
  return getPlayResearchId(play);
}

function getTimeBucket(play, now = new Date()) {
  const start = extractStartTime(play);
  const date = toDate(start);
  if (!date) return 'missing';
  const current = toDate(now) || new Date();
  const deltaMs = date.getTime() - current.getTime();
  const sameUtcDay = date.toISOString().slice(0, 10) === current.toISOString().slice(0, 10);
  if (deltaMs <= 0) return 'live';
  if (deltaMs <= 60 * 60 * 1000) return 'next1h';
  if (deltaMs <= 3 * 60 * 60 * 1000) return 'next3h';
  if (sameUtcDay) return 'today';
  return 'future';
}

function shouldRenderPlay(play, filters, decisionEntry, researchEntry) {
  if (!play) return false;
  const decisionStatus = String(decisionEntry?.status || '').toLowerCase();
  const hasResearch = Boolean(researchEntry && (researchEntry.summary || researchEntry.status === 'queued' || researchEntry.status === 'researching' || researchEntry.status === 'done'));
  const verdict = getPlayActionVerdict(play, researchEntry, decisionEntry);
  if (filters.hidePlaced && decisionStatus === 'placed') return false;
  if (filters.hideHidden && decisionStatus === 'hidden') return false;
  if (filters.unresearchedOnly && hasResearch) return false;
  if (filters.strongSupportOnly && !String(play.movementLabel || verdict.movementLabel || '').toLowerCase().includes('support')) return false;
  if (filters.plusMoneyOnly && !(Number(play.odds ?? play.price) > 0)) return false;
  if (filters.timeWindow && filters.timeWindow !== 'all') {
    const bucket = getTimeBucket(play, filters.now || new Date());
    if (filters.timeWindow !== bucket) return false;
  }
  return true;
}

function filterPlays(result = [], filters = {}, researchEntries = {}, decisionEntries = {}) {
  return (Array.isArray(result) ? result : [])
    .filter((play) => {
      const id = getPlayResearchId(play);
      return shouldRenderPlay(play, filters, decisionEntries[id], researchEntries[id]);
    });
}

function getHeroStats(filtered = [], researchEntries = {}, decisionEntries = {}) {
  let actionableNow = 0;
  let researchQueued = 0;
  let researchDoneNeedsDecision = 0;
  let hiddenOrPlaced = 0;
  for (const play of Array.isArray(filtered) ? filtered : []) {
    const id = getPlayResearchId(play);
    const researchEntry = researchEntries?.[id] || null;
    const decisionEntry = decisionEntries?.[id] || null;
    const verdict = getPlayActionVerdict(play, researchEntry, decisionEntry);
    const decisionStatus = String(decisionEntry?.status || '').toLowerCase();
    if (['placed', 'hidden'].includes(decisionStatus)) hiddenOrPlaced += 1;
    if (['queued', 'researching'].includes(String(researchEntry?.status || '').toLowerCase())) {
      researchQueued += 1;
      continue;
    }
    if (String(researchEntry?.status || '').toLowerCase() === 'done' && !decisionStatus) researchDoneNeedsDecision += 1;
    if (!decisionStatus && !['queued', 'researching'].includes(String(researchEntry?.status || '').toLowerCase())) {
      actionableNow += verdict.label === 'Bet' || verdict.priceStatus === 'Playable' || verdict.priceStatus === 'Verify' ? 1 : 0;
    }
  }
  return { actionableNow, researchQueued, researchDoneNeedsDecision, hiddenOrPlaced };
}

function renderResearchQueuePanel(researchEntries = [], decisionEntries = {}, diagnostics = null, filters = {}) {
  const counts = getResearchCounts(researchEntries);
  const rows = [...researchEntries]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 5)
    .map((entry) => {
      const id = entry.id || '';
      const play = entry.play || {};
      const verdict = getPlayActionVerdict(play, entry, decisionEntries[id]);
      const isFinished = ['done', 'failed'].includes(String(entry.status || '').toLowerCase());
      const actionButtons = isFinished ? `<div class="queue-actions"><form method="POST" action="/actions/research-requeue?${escapeHtml(buildQueryString(filters))}"><input type="hidden" name="id" value="${escapeHtml(id)}" /><button type="submit">Requeue</button></form><form method="POST" action="/actions/research-clear?${escapeHtml(buildQueryString(filters))}"><input type="hidden" name="id" value="${escapeHtml(id)}" /><button type="submit">Clear</button></form></div>` : '';
      return `<li><a href="#play-${escapeHtml(id)}">${escapeHtml(play.pick || play.selection || id || 'Research item')}</a><span>${escapeHtml(entry.status || '')}</span><span>${escapeHtml(verdict.label)}</span>${actionButtons}</li>`;
    })
    .join('');
  const chipParts = [];
  if (diagnostics?.tavilyKeyPresent) chipParts.push('Tavily ready');
  else chipParts.push('Missing TAVILY_API_KEY');
  chipParts.push(diagnostics?.allowFirecrawl ? 'Firecrawl allowed' : 'Firecrawl disabled');
  if (diagnostics?.generatedConfigHasMcpServers) chipParts.push('Config has MCP servers');
  return `
    <section class="research-queue panel">
      <div class="panel-head"><h2>Research Queue</h2><span>${counts.queued} queued · ${counts.researching} running · ${counts.done} done · ${counts.failed} failed</span>${counts.failed ? `<form method="POST" action="/actions/research-clear-failed?${escapeHtml(buildQueryString(filters))}"><button type="submit">Clear failed</button></form>` : ''}</div>
      <div class="research-chip">${escapeHtml(chipParts.join(' / '))}</div>
      ${diagnostics ? `<details class="research-diagnostics"><summary>Environment details</summary><div>HERMES_HOME: ${escapeHtml(diagnostics.hermesHome)}</div><div>Config path: ${escapeHtml(diagnostics.generatedConfigPath)}</div></details>` : ''}
      <ul class="queue-list">${rows || '<li class="empty-row">No research jobs yet.</li>'}</ul>
    </section>
  `;
}

async function fetchSharpPlays({ client = createPropProfessorClient(), filters = {} } = {}) {
  const handlers = createMcpHandlers({ client });
  const startedAt = Date.now();
  const result = await handlers.query_sharp_plays({
    book: filters.book,
    targetBooks: filters.targetBooks,
    leagues: filters.leagues,
    markets: filters.markets,
    limit: filters.limit,
    scanLimit: filters.scanLimit,
    minOdds: filters.minOdds,
    maxOdds: filters.maxOdds,
    minConsensusBookCount: filters.minConsensusBookCount,
    strict: filters.strict,
    includePasses: filters.includePasses,
    allowRecentOnly: filters.allowRecentOnly,
    maxAgeMs: filters.maxAgeMs,
    lookbackHours: filters.lookbackHours,
    debug: filters.debug,
    is_live: filters.is_live
  });
  return {
    ...result,
    fetchedAt: new Date().toISOString(),
    fetchDurationMs: Date.now() - startedAt,
    filters
  };
}

function summarizeBookPrices(play = {}, targetBooks = []) {
  const selections = play.selections && typeof play.selections === 'object' ? Object.values(play.selections) : [];
  const firstSelection = selections.find((selection) => selection && typeof selection === 'object' && selection.odds) || null;
  const oddsMap = firstSelection?.odds && typeof firstSelection.odds === 'object' ? firstSelection.odds : {};
  const rows = Object.values(oddsMap)
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      book: row.book || '',
      odds1: row.odds1 ?? null,
      odds2: row.odds2 ?? null,
      liquidity1: row.liquidity1 ?? null,
      liquidity2: row.liquidity2 ?? null
    }));
  const directBook = play.executionBook || play.targetBook || play.book || play.sharpPlaySupport?.targetBook || '';
  const directOdds = play.odds ?? play.currentOdds ?? play.price ?? null;
  if (directBook && directOdds !== null && directOdds !== undefined && !rows.some((row) => normalizeBookName(row.book) === normalizeBookName(directBook))) {
    rows.unshift({ book: normalizeBookName(directBook), odds1: directOdds, odds2: null, liquidity1: play.liquidity ?? null, liquidity2: null });
  }
  const wanted = normalizeTargetBookList(targetBooks, []);
  const filtered = wanted.length ? rows.filter((row) => wanted.includes(normalizeBookName(row.book))) : rows;
  return (filtered.length ? filtered : rows).slice(0, 12);
}

function getBestTargetBookPrice(play = {}, targetBooks = []) {
  const prices = summarizeBookPrices(play, targetBooks).map((row) => ({
    ...row,
    book: normalizeBookName(row.book),
    odds: parseAmericanOdds(row.odds1)
  })).filter((row) => row.book && row.odds !== null);
  if (!prices.length) return null;
  return prices.sort((left, right) => right.odds - left.odds)[0];
}

function getMarketExplanation(play = {}, verdict = {}) {
  const source = play.movementSourceBook || verdict.movementSourceBook || '';
  const comps = Number(play.consensusBookCount ?? verdict.consensusBookCount ?? play.sharpPlaySupport?.consensusBookCount ?? 0);
  const price = verdict.priceStatus || getPriceStatus(play).status;
  if (price === 'Too expensive') return `Too expensive now; playable only at ${verdict.playablePrice || 'a better number'}.`;
  if (verdict.priceStatus === 'Verify') return 'Good price signal; verify target-book price before betting.';
  if (source && comps) return `${source} moved toward this side; ${comps} sharp comp${comps === 1 ? '' : 's'} aligned.`;
  if (source) return `${source} is the movement source; check comp breadth before betting.`;
  return 'Needs quick market and matchup verification before action.';
}

function summarizeLineHistory(play = {}) {
  const history = Array.isArray(play.lineHistory) ? play.lineHistory : [];
  const byBook = new Map();
  for (const point of history) {
    const book = point?.book || point?.raw?.book || 'unknown';
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book).push(point);
  }
  return Array.from(byBook.entries()).map(([book, points]) => {
    const sorted = points.slice().sort((a, b) => Number(a.time || a.raw?.start_ts || 0) - Number(b.time || b.raw?.start_ts || 0));
    const first = sorted[0] || {};
    const last = sorted[sorted.length - 1] || {};
    return {
      book,
      firstOdds: first.odds ?? first.raw?.odds ?? null,
      lastOdds: last.odds ?? last.raw?.odds ?? null,
      pointCount: sorted.length
    };
  }).slice(0, 10);
}

function parseDotenvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eqIdx = line.indexOf('=');
    const key = line.slice(0, eqIdx).trim().replace(/^export\s+/, '');
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function createResearchWebConfig({ configPath = RESEARCH_WEB_CONFIG_PATH, baseConfigPath = path.join(DEFAULT_HERMES_HOME, 'config.yaml') } = {}) {
  ensureDir(path.dirname(configPath));
  let content = '';
  if (baseConfigPath && fs.existsSync(baseConfigPath)) {
    content = fs.readFileSync(baseConfigPath, 'utf8');
  }

  content = content.replace(/^mcp_servers:\s*\n(?:^[ \t]+.*\n?)*/m, '');

  if (/^web:\s*$/m.test(content)) {
    content = content.replace(/^web:\s*\n(?:^[ \t]+.*\n?)*/m, 'web:\n  backend: tavily\n  search_backend: tavily\n  extract_backend: tavily\n  use_gateway: false\n');
  } else {
    content += `${content.endsWith('\n') || !content ? '' : '\n'}web:\n  backend: tavily\n  search_backend: tavily\n  extract_backend: tavily\n  use_gateway: false\n`;
  }

  fs.writeFileSync(configPath, content);
  const sourceAuthPath = path.join(DEFAULT_HERMES_HOME, 'auth.json');
  const targetAuthPath = path.join(path.dirname(configPath), 'auth.json');
  if (fs.existsSync(sourceAuthPath) && !fs.existsSync(targetAuthPath)) {
    try {
      fs.symlinkSync(sourceAuthPath, targetAuthPath);
    } catch {
      fs.copyFileSync(sourceAuthPath, targetAuthPath);
    }
  }
  return configPath;
}

function buildResearchChildEnv({ envFile = process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH || DEFAULT_HERMES_ENV_PATH } = {}) {
  const dotenvEnv = parseDotenvFile(envFile);
  const childEnv = { ...process.env, ...dotenvEnv };
  const hermesHome = childEnv.HERMES_HOME || DEFAULT_HERMES_HOME;
  childEnv.HERMES_HOME = hermesHome;

  if (childEnv.TAVILY_API_KEY && !process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH) {
    const configPath = createResearchWebConfig();
    const configHome = path.dirname(configPath);
    childEnv.HERMES_HOME = configHome;
    childEnv.PP_SHARP_PLAYS_PARENT_HERMES_HOME = hermesHome;
  }

  return childEnv;
}

function buildResearchDiagnostics({ envFile = process.env.PP_SHARP_PLAYS_RESEARCH_ENV_PATH || DEFAULT_HERMES_ENV_PATH } = {}) {
  const dotenvEnv = parseDotenvFile(envFile);
  const hermesHome = dotenvEnv.HERMES_HOME || process.env.HERMES_HOME || DEFAULT_HERMES_HOME;
  const tavilyKeyPresent = Boolean(dotenvEnv.TAVILY_API_KEY || process.env.TAVILY_API_KEY);
  const allowFirecrawl = Boolean(process.env.PP_SHARP_PLAYS_ALLOW_FIRECRAWL_RESEARCH);
  const generatedConfigPath = RESEARCH_WEB_CONFIG_PATH;
  if (tavilyKeyPresent && !allowFirecrawl) {
    createResearchWebConfig({ configPath: generatedConfigPath, baseConfigPath: path.join(hermesHome, 'config.yaml') });
  }
  let generatedConfigText = '';
  try {
    if (generatedConfigPath && fs.existsSync(generatedConfigPath)) generatedConfigText = fs.readFileSync(generatedConfigPath, 'utf8');
  } catch {
    generatedConfigText = '';
  }
  return {
    hermesHome,
    envPath: envFile,
    tavilyKeyPresent,
    allowFirecrawl,
    generatedConfigPath,
    generatedConfigHasMcpServers: /^mcp_servers:\s*$/m.test(generatedConfigText) || /\nmcp_servers:\s*\n/m.test(generatedConfigText),
    generatedConfigWebBackend: generatedConfigText.match(/search_backend:\s*([^\n]+)/)?.[1]?.trim() || generatedConfigText.match(/backend:\s*([^\n]+)/)?.[1]?.trim() || ''
  };
}

function buildResearchPayload(entry = {}) {
  const play = entry.play || {};
  const identity = getPlayIdentityPayload(play);
  const targetBookPayloadSource = 'PropProfessor screen snapshot';
  const targetBookFetchedAt = entry.targetBookFetchedAt || play.targetBookFetchedAt || play.targetBookSnapshot?.fetchedAt || null;
  const targetBookCurrentOdds = play.currentOdds ?? play.odds ?? play.price ?? null;
  const targetBookNeedsManualVerification = targetBookCurrentOdds === null || targetBookCurrentOdds === undefined || targetBookCurrentOdds === '' || !targetBookFetchedAt;
  return {
    id: entry.id,
    identity,
    filters: entry.filters || {},
    event: {
      league: play.scanLeague || play.league || play.leaguePreset || '',
      market: play.scanMarket || play.screenMarket || play.market || play.playType || '',
      game: play.game || play.matchup || [play.awayTeam, play.homeTeam].filter(Boolean).join(' vs ') || play.gameId || '',
      pick: play.pick || play.selection || play.participant || '',
      participant: play.participant || '',
      start: play.start || play.startTime || play.commenceTime || play.gameStartTime || null,
      isLive: Boolean(play.isLive)
    },
    targetBook: {
      book: play.book || play.sharpPlaySupport?.targetBook || '',
      odds: play.odds ?? play.currentOdds ?? play.price ?? null,
      currentOdds: play.currentOdds ?? null,
      line: play.line ?? null,
      liquidity: play.liquidity ?? null,
      targetBookPayloadSource,
      targetBookFetchedAt,
      targetBookCurrentOdds,
      targetBookNeedsManualVerification
    },
    sharpSupport: {
      verdict: play.verdict || '',
      sharpPlayScore: play.sharpPlayScore ?? null,
      consensusBookCount: play.consensusBookCount ?? play.sharpPlaySupport?.consensusBookCount ?? null,
      consensusEdge: play.consensusEdge ?? null,
      movementSourceBook: play.movementSourceBook || play.sharpPlaySupport?.movementSourceBook || '',
      movementLabel: play.movementLabel || play.sharpPlaySupport?.movementLabel || '',
      movementMode: play.movementMode || play.sharpPlaySupport?.movementMode || '',
      movementQuality: play.movementQuality || '',
      rankingReason: play.rankingReason || play.rankingProvenance?.rankingReason || '',
      passReasons: Array.isArray(play.passReasons) ? play.passReasons : []
    },
    prices: summarizeBookPrices(play),
    lineHistorySummary: summarizeLineHistory(play),
    scoreBreakdown: play.scoreBreakdown || null
  };
}

function buildResearchPrompt(entry = {}) {
  const payload = buildResearchPayload(entry);
  return `Validate this PropProfessor sharp-play candidate for James. Do not place a bet. Do not just restate the sharp consensus/movement already in the payload — use it as the starting point, then look for reasons this play should be bet, watched, or passed.

Return a short operator verdict with these exact labels:

Verdict: Bet / Pass / Watch / Stale
Playable price: minimum target-book price or n/a
Confidence: Low / Medium / High
Evidence checked: 2-4 bullets naming what you actually checked
Matchup analysis: 2-4 bullets on the actual matchup, not odds movement
Reason: 1-3 bullets
Concern: 1-2 bullets
Action: one sentence

External checks required before verdict:
- Verify the event has not started/finished and the market still exists at the target book or a comparable live source.
- Check current target-book price against the playable price and sharp cluster.
- Do matchup analysis for the sport instead of only market analysis.
- If web_search/web_extract/scrape tools fail with auth, Unauthorized, 401, 403, or provider errors, do not stop there. Use the terminal tool as fallback: curl or Python urllib against public pages/APIs, or Tavily via TAVILY_API_KEY if available. If every fallback fails, mark Confidence: Low and make Action: Watch/Pass unless the target-book price itself is still visibly available in the payload.
- If you cannot verify a check, say so under Evidence checked or Concern instead of pretending.

Preferred external sources:
- Tennis: Flashscore, Sofascore, official tournament sites, WTA, ATP.
- MLB: MLB probable pitchers, lineups, weather.
- NBA/NHL/NFL: official injury reports, team reports, goalie/QB reports where relevant.

Sport-specific matchup analysis:
- Tennis: compare player form, surface fit, head-to-head if useful, fatigue/rest, travel, injury/retirement risk, tournament motivation, ranking/serve-return profile, and whether the match is already live/finished. Treat tennis matchup context as required, not optional.
- MLB: check probable pitchers, handedness/splits, bullpen rest, lineup/news, park/weather, travel/rest, and whether listed pitchers changed.
- NBA/WNBA/NHL/NFL/NCAAF/NCAAB: check injuries, starters/goalie/QB where relevant, rest/travel/back-to-back, matchup style, motivation, and lineup/news.
- Soccer: check lineups/rotation, injuries/suspensions, schedule congestion, home/away context, and market/team news.

Validation rules:
- Confirm current target-book price is still playable.
- Check sharp cluster and consensus, not just one book.
- Interpret movement correctly: favorites supportive when they get more expensive; underdogs supportive when they get shorter. Underdog +119 to +134 is adverse, not supportive.
- For tennis, PropProfessor start times are often wrong. Do not mark a tennis play stale solely from the PP start time. Only use time/status as a pass reason if you externally verify the match already started/finished, or if live target-book odds are gone.
- If tennis schedule/status cannot be externally verified, label the time issue as a concern/watch item, not an automatic stale verdict.
- Flag stale odds, externally verified wrong start time, injuries/news, thin consensus/liquidity, target-book-only movement, weak matchup context, or missing external confirmation.
- Do not cite search snippets as proof the target-book price is available. Use the payload/live target-book source if present; otherwise say the target book was not directly verified.

Candidate payload:
${JSON.stringify(payload, null, 2)}
`;
}

function runResearchAgent(entry, queue) {
  const researchDir = process.env.PP_SHARP_PLAYS_RESEARCH_DIR || DEFAULT_RESEARCH_DIR;
  ensureDir(researchDir);
  const prompt = buildResearchPrompt(entry);
  const promptPath = path.join(researchDir, `${entry.id}.prompt.txt`);
  const outputPath = path.join(researchDir, `${entry.id}.output.txt`);
  fs.writeFileSync(promptPath, prompt);

  const command = process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND || 'hermes';
  const args = process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND
    ? []
    : ['--oneshot', prompt, '--toolsets', 'web,terminal'];
  const childEnv = buildResearchChildEnv();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: Boolean(process.env.PP_SHARP_PLAYS_RESEARCH_COMMAND),
    env: childEnv
  });

  const timeoutMs = Number(process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS) || DEFAULT_RESEARCH_TIMEOUT_MS;
  let finished = false;
  let timeoutHandle = null;
  const finalize = (patch) => {
    if (finished) return false;
    finished = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    queue.update(entry.id, patch);
    return true;
  };

  queue.update(entry.id, { status: 'researching', pid: child.pid, promptPath, outputPath, error: null, summary: '' });

  const outputChunks = [];
  const errorChunks = [];
  child.stdout.on('data', (chunk) => outputChunks.push(chunk));
  child.stderr.on('data', (chunk) => errorChunks.push(chunk));
  child.on('error', (error) => {
    finalize({ status: 'failed', error: error.message, completedAt: new Date().toISOString() });
  });
  child.on('close', (code) => {
    const summary = cleanResearchSummary(Buffer.concat(outputChunks).toString('utf8').trim());
    const stderr = Buffer.concat(errorChunks).toString('utf8').trim();
    try {
      fs.writeFileSync(outputPath, `${summary}${stderr ? `\n\n[stderr]\n${stderr}` : ''}\n`);
    } catch {
      // write failure is silent
    }
    finalize({
      status: code === 0 ? 'done' : 'failed',
      completedAt: new Date().toISOString(),
      exitCode: code,
      summary,
      error: code === 0 ? null : stderr || `Hermes exited with code ${code}`,
      outputPath
    });
  });
  timeoutHandle = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch {
      // kill failure is silent
    }
    finalize({
      status: 'failed',
      error: `Research timed out after ${Math.round(timeoutMs / 60000)}m`,
      completedAt: new Date().toISOString(),
      exitCode: null,
      outputPath
    });
  }, timeoutMs);
  child.unref();
  return child;
}

function renderFilters(filters) {
  const checked = (value) => (value ? 'checked' : '');
  const selectedLeague = getSelectedLeagueValue(filters.leagues);
  const selectedMarket = getSelectedMarketValue(filters.markets);
  const customLeagueInput = selectedLeague.includes(',') ? selectedLeague : '';
  const customMarketInput = selectedMarket.includes(',') ? selectedMarket : '';
  const selectedLeagueCsv = Array.isArray(filters.leagues) ? filters.leagues.join(',') : '';
  const selectedMarketCsv = Array.isArray(filters.markets) ? filters.markets.join(',') : '';
  const selectedBooks = normalizeTargetBookList(filters.targetBooks || filters.book || DEFAULT_TARGET_BOOKS);
  const bookToggleHtml = TARGET_BOOK_OPTIONS.map((option) => {
    const isChecked = selectedBooks.includes(option.value);
    return `<label class="book-toggle ${isChecked ? 'active' : ''}"><input name="targetBooks" type="checkbox" value="${escapeHtml(option.value)}" ${checked(isChecked)} /><span>${escapeHtml(option.label)}</span></label>`;
  }).join('');
  return `
    <form class="filters command-bar" method="GET" action="/">
      <input type="hidden" name="book" value="${escapeHtml(selectedBooks[0] || DEFAULT_BOOK)}" />
      <div class="command-primary">
        <div class="command-group execution-books">
          <span class="command-label">Execution books</span>
          <div class="book-toggle-row">${bookToggleHtml}</div>
        </div>
        <label>League
          <select name="leagues">${renderOptions(LEAGUE_OPTIONS, selectedLeague)}</select>
        </label>
        <label>Market
          <select name="markets">${renderOptions(MARKET_OPTIONS, selectedMarket)}</select>
        </label>
        <label>Window
          <select name="timeWindow">
            ${renderOptions([
              { value: 'all', label: 'All' },
              { value: 'live', label: 'Live' },
              { value: 'next1h', label: 'Next 1h' },
              { value: 'next3h', label: 'Next 3h' },
              { value: 'today', label: 'Today' },
              { value: 'missing', label: 'Missing' }
            ], filters.timeWindow || 'all')}
          </select>
        </label>
        <label class="mode-toggle"><input type="hidden" name="broad" value="0" /><input name="broad" type="checkbox" value="1" ${checked(!filters.strict)} /><span>Broad mode</span></label>
        <button type="submit">Refresh plays</button>
      </div>
      ${selectedLeagueCsv ? `<input type="hidden" name="leaguesCsv" value="${escapeHtml(selectedLeagueCsv)}" />` : ''}
      ${selectedMarketCsv ? `<input type="hidden" name="marketsCsv" value="${escapeHtml(selectedMarketCsv)}" />` : ''}
      ${customLeagueInput ? `<input type="hidden" name="leagues" value="${escapeHtml(customLeagueInput)}" />` : ''}
      ${customMarketInput ? `<input type="hidden" name="markets" value="${escapeHtml(customMarketInput)}" />` : ''}
      <details class="advanced-filters">
        <summary>Advanced filters</summary>
        <div class="advanced-grid">
          <label>Limit <input name="limit" type="number" min="1" max="50" value="${escapeHtml(filters.limit)}" /></label>
          <label>Scan limit <input name="scanLimit" type="number" min="5" max="100" value="${escapeHtml(filters.scanLimit)}" /></label>
          <label>Min odds <input name="minOdds" placeholder="-120" value="${escapeHtml(filters.minOdds ?? '')}" /></label>
          <label>Max odds <input name="maxOdds" placeholder="150" value="${escapeHtml(filters.maxOdds ?? '')}" /></label>
          <label>Min comps <input name="minConsensusBookCount" type="number" min="1" max="10" value="${escapeHtml(filters.minConsensusBookCount)}" /></label>
          <label>Lookback <input name="lookbackHours" type="number" min="1" max="48" value="${escapeHtml(filters.lookbackHours)}" /></label>
          <label class="check"><input type="hidden" name="includePasses" value="0" /><input name="includePasses" type="checkbox" value="1" ${checked(filters.includePasses)} /> show passes</label>
          <label class="check"><input type="hidden" name="allowRecentOnly" value="0" /><input name="allowRecentOnly" type="checkbox" value="1" ${checked(filters.allowRecentOnly)} /> recent-only ok</label>
          <label class="check"><input type="hidden" name="hidePlaced" value="0" /><input name="hidePlaced" type="checkbox" value="1" ${checked(filters.hidePlaced)} /> hide placed</label>
          <label class="check"><input type="hidden" name="hideHidden" value="0" /><input name="hideHidden" type="checkbox" value="1" ${checked(filters.hideHidden)} /> hide hidden</label>
          <label class="check"><input type="hidden" name="unresearchedOnly" value="0" /><input name="unresearchedOnly" type="checkbox" value="1" ${checked(filters.unresearchedOnly)} /> unresearched only</label>
          <label class="check"><input type="hidden" name="strongSupportOnly" value="0" /><input name="strongSupportOnly" type="checkbox" value="1" ${checked(filters.strongSupportOnly)} /> strong support only</label>
          <label class="check"><input type="hidden" name="plusMoneyOnly" value="0" /><input name="plusMoneyOnly" type="checkbox" value="1" ${checked(filters.plusMoneyOnly)} /> +money only</label>
        </div>
      </details>
      <div class="quick-presets">
        <a href="/?${escapeHtml(buildQueryString(filters, { targetBooks: ['Fliff', 'NoVigApp'], markets: ['Moneyline'], strict: true }))}">Fliff + NoVig mainlines</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { leagues: ['Tennis'] }))}">Tennis only</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { timeWindow: 'next3h' }))}">Next 3 hours</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { plusMoneyOnly: true }))}">+money only</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { strict: false, includePasses: true }))}">Broad scan</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { strict: true, includePasses: false }))}">Strict bets</a>
      </div>
    </form>
  `;
}

function renderResearchBlock(play, filters, researchEntry, decisionEntry) {
  const playJson = escapeHtml(JSON.stringify(play));
  const status = researchEntry?.status || 'not researched';
  const summary = researchEntry?.summary || researchEntry?.error || '';
  const isBusy = ['queued', 'researching'].includes(status);
  const verdict = getPlayActionVerdict(play, researchEntry, decisionEntry);
  const parsed = parseResearchVerdict(researchEntry?.summary || '');
  const priceStatus = getPriceStatus(play, researchEntry);
  const startText = formatStartTime(extractStartTime(play));
  const timeUntil = formatTimeUntil(extractStartTime(play));
  const caution = isTennisPlay(play) ? '<p class="caution">Tennis caution: verify timing externally before treating PP time as stale.</p>' : '';
  const movementNote = `<p class="movement-note ${escapeHtml(labelClass(play.movementLabel || verdict.movementLabel))}">${escapeHtml(getMovementNote(play, verdict))}</p>`;
  const riskFlags = getResearchRiskFlags({ summary, play });
  const verifyTargetPrice = !verdict.directTargetBookVerified && /\b(bet|lean)\b/i.test(String(parsed.verdict || play.verdict || verdict.verdict || ''));
  return `
    <div class="research-box ${escapeHtml(labelClass(status))}">
      <form method="POST" action="/actions/research-play?${escapeHtml(buildQueryString(filters))}">
        <input type="hidden" name="play" value="${playJson}" />
        <button type="submit" ${isBusy ? 'disabled' : ''}>${isBusy ? 'Research queued' : 'Research'}</button>
      </form>
      <div class="research-status">
        <strong>${escapeHtml(status)}</strong>
        ${researchEntry?.updatedAt ? `<span>${escapeHtml(new Date(researchEntry.updatedAt).toLocaleString('en-US', { hour12: true }))}</span>` : '<span>Queue an agent validation</span>'}
      </div>
      <div class="triage-meta">
        <span>${escapeHtml(startText)}</span>
        <span>${escapeHtml(timeUntil)}</span>
        <span>${escapeHtml(priceStatus.status)}</span>
        <span>${escapeHtml(priceStatus.playablePrice || parsed.playablePrice || 'Playable price n/a')}</span>
      </div>
      ${verifyTargetPrice ? '<p class="caution">Verify target price</p>' : ''}
      ${riskFlags.length ? `<div class="risk-flags">${riskFlags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join('')}</div>` : ''}
      ${movementNote}
      ${caution}
      ${summary ? `<details><summary>Research summary</summary><pre>${escapeHtml(summary).slice(0, 1400)}</pre></details>` : ''}
    </div>
  `;
}

function renderPlayCard(play, index, context = {}) {
  const support = play.sharpPlaySupport || {};
  const game = play.game || play.matchup || [play.awayTeam, play.homeTeam].filter(Boolean).join(' vs ') || play.gameId || 'Unknown game';
  const pick = play.pick || play.selection || play.participant || 'Unknown pick';
  const market = play.scanMarket || play.screenMarket || play.market || play.playType || 'Market';
  const league = play.scanLeague || play.league || play.leaguePreset || '';
  const researchId = getPlayResearchId(play);
  const researchEntry = context.researchEntries?.[researchId] || null;
  const decisionEntry = context.decisionEntries?.[researchId] || null;
  const verdict = getPlayActionVerdict(play, researchEntry, decisionEntry);
  const priceStatus = getPriceStatus(play, researchEntry);
  const startTime = extractStartTime(play);
  const timeUntil = formatTimeUntil(startTime);
  const startLabel = formatStartTime(startTime);
  const sharpScore = formatScore(play.sharpPlayScore);
  const counts = play.consensusBookCount ?? 0;
  const playablePrice = verdict.playablePrice || priceStatus.playablePrice || 'n/a';
  const actionLabel = verdict.label === 'Research first' && priceStatus.status === 'Playable' && verdict.directTargetBookVerified ? 'Bet candidate' : verdict.label;
  const targetBooks = context.filters?.targetBooks || DEFAULT_TARGET_BOOKS;
  const bestPrice = getBestTargetBookPrice(play, targetBooks);
  const priceRows = summarizeBookPrices(play, targetBooks);
  const priceStrip = `<div class="price-strip">
    ${bestPrice ? `<span class="best-price">Best: ${escapeHtml(bestPrice.book)} ${escapeHtml(formatOdds(bestPrice.odds))}</span>` : ''}
    ${priceRows.map((row) => `<span>${escapeHtml(normalizeBookName(row.book))} ${escapeHtml(formatOdds(row.odds1))}</span>`).join('')}
    <span>Playable to ${escapeHtml(playablePrice)}</span>
    <span class="${labelClass(priceStatus.status)}">${escapeHtml(priceStatus.status)}</span>
  </div>`;
  const marketExplanation = getMarketExplanation(play, verdict);
  const actions = [
    { label: 'Research', action: '/actions/research-play' },
    { label: 'Placed', action: '/actions/play-decision', status: 'placed' },
    { label: 'Hide', action: '/actions/play-decision', status: 'hidden' },
    { label: 'Watch', action: '/actions/play-decision', status: 'watch' },
    { label: 'Pass', action: '/actions/play-decision', status: 'passed' },
    { label: 'Clear', action: '/actions/play-decision', status: 'cleared' }
  ];
  const actionForms = actions.map((button) => {
    if (button.action === '/actions/research-play') {
      return `<form method="POST" action="${button.action}?${escapeHtml(buildQueryString(context.filters || {}))}"><input type="hidden" name="play" value="${escapeHtml(JSON.stringify(play))}" /><button type="submit">${button.label}</button></form>`;
    }
    return `<form method="POST" action="${button.action}?${escapeHtml(buildQueryString(context.filters || {}))}"><input type="hidden" name="id" value="${escapeHtml(researchId)}" /><input type="hidden" name="play" value="${escapeHtml(JSON.stringify(play))}" /><input type="hidden" name="status" value="${escapeHtml(button.status)}" /><input type="hidden" name="note" value="${escapeHtml(verdict.reason || '')}" /><button type="submit">${button.label}</button></form>`;
  }).join('');
  const reasons = Array.isArray(play.passReasons) && play.passReasons.length ? play.passReasons : [];
  return `
    <article id="play-${escapeHtml(researchId)}" class="play-card ${labelClass(actionLabel)}" data-play-id="${escapeHtml(researchId)}">
      <div class="rank">#${index + 1}</div>
      <div class="play-main">
        <div class="play-title">${escapeHtml(pick)}</div>
        <div class="play-subtitle">${escapeHtml(game)}</div>
        <div class="chips">
          <span>${escapeHtml(league)}</span>
          <span>${escapeHtml(market)}</span>
          <span>${escapeHtml(play.executionBook || play.targetBook || play.book || support.targetBook || '')} ${escapeHtml(formatOdds(play.odds))}</span>
          <span class="${labelClass(actionLabel)}">${escapeHtml(actionLabel)}</span>
          <span class="${labelClass(play.movementLabel)}">${escapeHtml(play.movementLabel || 'no movement')}</span>
        </div>
        <div class="timeline"><strong>${escapeHtml(startLabel)}</strong><span>${escapeHtml(timeUntil)}</span></div>
        ${priceStrip}
        <p class="market-explanation">${escapeHtml(marketExplanation)}</p>
      </div>
      <div class="metric"><strong>${escapeHtml(sharpScore)}</strong><span>score</span></div>
      <div class="metric"><strong>${escapeHtml(counts)}</strong><span>comps</span></div>
      <div class="metric"><strong>${escapeHtml(play.movementSourceBook || 'n/a')}</strong><span>move src</span></div>
      <div class="metric"><strong>${escapeHtml(playablePrice)}</strong><span>playable</span></div>
      <div class="actions">${actionForms}</div>
      ${renderResearchBlock(play, context.filters || {}, researchEntry, decisionEntry)}
      ${reasons.length ? `<div class="reasons">${reasons.map((reason) => `<code>${escapeHtml(reason)}</code>`).join(' ')}</div>` : ''}
    </article>
  `;
}

function renderEmpty(snapshot, filters = {}) {
  const scanned = snapshot?.resultMeta?.scannedRowCount ?? 0;
  const books = snapshot?.resultMeta?.targetBooks || filters.targetBooks || DEFAULT_TARGET_BOOKS;
  const leagues = filters.leagues || snapshot?.resultMeta?.leagues || DEFAULT_LEAGUES;
  const markets = filters.markets || snapshot?.resultMeta?.markets || DEFAULT_MARKETS;
  return `
    <section class="empty">
      <h2>No clean plays.</h2>
      <p>Scanned ${escapeHtml(scanned)} ranked rows across ${escapeHtml(books.join(' + '))} for ${escapeHtml(leagues.join('/'))} ${escapeHtml(markets.join('/'))}.</p>
      <div class="empty-actions">
        <a href="/?${escapeHtml(buildQueryString(filters, { strict: false, includePasses: true }))}">Try broad mode</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { includePasses: true }))}">Show passes</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { minConsensusBookCount: 1 }))}">Lower min comps to 1</a>
        <a href="/?${escapeHtml(buildQueryString(filters, { markets: ['Moneyline', 'Spread', 'Total'] }))}">All main markets</a>
      </div>
    </section>
  `;
}

function renderPage({ snapshot, filters, error = null, researchEntries = {}, decisionEntries = {}, diagnostics = null } = {}) {
  const result = Array.isArray(snapshot?.result) ? snapshot.result : [];
  const filtered = filterPlays(result, filters, researchEntries, decisionEntries);
  const meta = snapshot?.resultMeta || {};
  const fetchedAt = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt) : null;
  const qs = buildQueryString(filters);
  const researchList = Object.values(researchEntries || {});
  const heroStats = getHeroStats(filtered, researchEntries, decisionEntries);
  const scannedBooks = meta.targetBooks || filters.targetBooks || DEFAULT_TARGET_BOOKS;
  const fetchedAtText = fetchedAt ? fetchedAt.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'not fetched yet';
  const fetchDuration = Number.isFinite(Number(snapshot?.fetchDurationMs)) ? `${snapshot.fetchDurationMs}ms` : 'n/a';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="${DEFAULT_REFRESH_SECONDS}; url=/?${escapeHtml(qs)}" />
  <title>PP Sharp Plays</title>
  <style>
    :root { color-scheme: dark; --bg:#07111d; --panel:#0d1728; --panel2:#111f34; --text:#edf3ff; --muted:#8f9fb8; --line:#22344b; --good:#33d69f; --warn:#f3c85b; --bad:#ff6b7a; --blue:#7da8ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(91,140,255,.12), transparent 28%), linear-gradient(180deg, #050b14, var(--bg)); color:var(--text); }
    a { color: var(--blue); text-decoration: none; }
    .shell { max-width: 1500px; margin: 0 auto; padding: 24px; }
    .hero { display:grid; grid-template-columns: 1.8fr 1fr; gap:16px; margin-bottom:16px; align-items:stretch; }
    .hero-copy, .hero-stats, .panel, .filters { border:1px solid var(--line); border-radius:22px; background:rgba(13,23,40,.82); box-shadow:0 22px 60px rgba(0,0,0,.22); }
    .hero-copy { padding:24px; }
    .eyebrow { color:var(--blue); text-transform:uppercase; letter-spacing:.14em; font-size:11px; font-weight:800; }
    h1 { margin:8px 0 0; font-size: clamp(34px, 4vw, 58px); letter-spacing:-.06em; }
    .lede { color:var(--muted); max-width:760px; line-height:1.5; margin:12px 0 0; }
    .hero-stats { padding:16px; display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; }
    .stat { padding:14px; border-radius:18px; background:linear-gradient(180deg, rgba(17,31,52,.92), rgba(11,21,36,.88)); border:1px solid rgba(34,52,75,.92); }
    .stat strong { display:block; font-size:28px; letter-spacing:-.04em; }
    .stat span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.09em; }
    .filters { display:block; padding:16px; margin-bottom:16px; }
    .command-primary { display:grid; grid-template-columns:minmax(260px,1.3fr) repeat(3,minmax(130px,.7fr)) minmax(120px,.55fr) auto; gap:12px; align-items:end; }
    .command-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:800; }
    .book-toggle-row, .quick-presets, .empty-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:7px; }
    .book-toggle { display:flex; flex-direction:row; align-items:center; gap:8px; padding:9px 12px; border:1px solid var(--line); border-radius:999px; background:#071020; color:#d6e2f5; text-transform:none; letter-spacing:0; font-size:13px; cursor:pointer; }
    .book-toggle input { width:auto; accent-color:var(--good); }
    .book-toggle.active { border-color:rgba(51,214,159,.45); background:rgba(51,214,159,.10); color:var(--text); }
    .mode-toggle { flex-direction:row; align-items:center; gap:8px; justify-content:center; border:1px solid var(--line); border-radius:14px; background:#071020; padding:10px 12px; color:#d6e2f5; text-transform:none; letter-spacing:0; }
    .mode-toggle input { width:auto; accent-color:var(--blue); }
    .advanced-filters { margin-top:12px; border-top:1px solid var(--line); padding-top:12px; }
    .advanced-filters summary { color:var(--blue); cursor:pointer; font-weight:800; }
    .advanced-grid { display:grid; grid-template-columns:repeat(6, minmax(120px, 1fr)); gap:12px; padding-top:12px; }
    .quick-presets a, .empty-actions a { color:#d6e2f5; border:1px solid var(--line); background:#071020; border-radius:999px; padding:7px 10px; font-size:12px; }
    .hero-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
    .hero-meta span { border:1px solid var(--line); background:#071020; color:#d6e2f5; border-radius:999px; padding:6px 9px; font-size:12px; }
    label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; display:flex; flex-direction:column; gap:6px; }
    label.check { justify-content:end; flex-direction:row; align-items:center; text-transform:none; letter-spacing:0; font-size:13px; }
    input, select { width:100%; border:1px solid var(--line); border-radius:12px; padding:10px 12px; background:#071020; color:var(--text); font:inherit; }
    button { border:0; border-radius:14px; padding:11px 14px; background:linear-gradient(135deg,#38d5a3,#7da8ff); color:#04111f; font-weight:900; cursor:pointer; align-self:end; }
    .content { display:grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, .9fr); gap:16px; align-items:start; }
    .board { display:grid; gap:12px; }
    .play-card { display:grid; grid-template-columns:56px minmax(0,1.35fr) repeat(4, minmax(96px, max-content)); gap:14px; align-items:flex-start; padding:16px; border:1px solid var(--line); border-radius:22px; background:linear-gradient(180deg, rgba(17,31,52,.98), rgba(10,18,31,.96)); }
    .play-card.good { border-color:rgba(51,214,159,.42); box-shadow:0 0 0 1px rgba(51,214,159,.08), 0 16px 44px rgba(0,0,0,.18); }
    .play-card.warn { border-color:rgba(243,200,91,.38); }
    .play-card.bad { opacity:.88; }
    .rank { color:var(--muted); font-size:24px; font-weight:900; line-height:1; }
    .play-title { font-size:19px; font-weight:900; letter-spacing:-.02em; }
    .play-subtitle { color:var(--muted); margin-top:3px; }
    .chips, .timeline, .triage-meta, .actions, .price-strip { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    .price-strip span { border:1px solid var(--line); background:#071020; color:#d6e2f5; border-radius:999px; padding:6px 10px; font-size:12px; }
    .price-strip .best-price { border-color:rgba(51,214,159,.46); color:var(--good); background:rgba(51,214,159,.10); font-weight:900; }
    .market-explanation { margin:10px 0 0; color:#c9d6ea; font-size:13px; line-height:1.4; }
    .timeline { margin-top:12px; color:var(--muted); font-size:13px; }
    .timeline strong { color:var(--text); }
    .chips span, .triage-meta span { border:1px solid var(--line); background:#071020; color:#d6e2f5; border-radius:999px; padding:5px 9px; font-size:12px; }
    .chips .good, .good { color:var(--good); border-color:rgba(51,214,159,.35); }
    .chips .warn, .warn { color:var(--warn); border-color:rgba(243,200,91,.35); }
    .chips .bad, .bad { color:var(--bad); border-color:rgba(255,107,122,.35); }
    .metric { text-align:right; min-width:86px; }
    .metric strong { display:block; font-size:18px; }
    .metric span { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .actions { grid-column:2 / -1; margin-top:0; }
    .actions form { margin:0; }
    .actions button { padding:8px 10px; border-radius:12px; font-size:12px; }
    .research-box { grid-column:2 / -1; display:grid; gap:10px; border:1px solid var(--line); border-radius:18px; padding:12px; background:rgba(7,16,32,.72); }
    .research-box form { margin:0; }
    .research-box button[disabled] { opacity:.62; cursor:not-allowed; filter:saturate(.65); }
    .research-status strong { display:block; text-transform:uppercase; letter-spacing:.08em; font-size:12px; }
    .research-status span { color:var(--muted); font-size:12px; }
    .triage-meta { margin-top:0; }
    .caution { margin:0; color:var(--warn); font-size:13px; }
    .research-box details { border-top:1px solid var(--line); padding-top:8px; }
    .research-box summary { cursor:pointer; color:var(--blue); font-weight:700; }
    .research-box pre { white-space:pre-wrap; margin:8px 0 0; color:#c9d6ea; background:#071020; border:1px solid var(--line); border-radius:12px; padding:10px; max-height:240px; overflow:auto; }
    .reasons { grid-column: 2 / -1; display:flex; flex-wrap:wrap; gap:8px; }
    code { color:#fbbfcb; background:#1f1020; border:1px solid rgba(255,107,122,.25); border-radius:9px; padding:4px 7px; font-size:12px; }
    .panel { padding:16px; }
    .panel-head { display:flex; justify-content:space-between; gap:8px; align-items:baseline; margin-bottom:12px; }
    .panel-head h2 { margin:0; font-size:18px; }
    .panel-head span { color:var(--muted); font-size:12px; }
    .queue-list { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
    .queue-list li { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:14px; background:rgba(7,16,32,.72); }
    .queue-list .empty-row { color:var(--muted); grid-template-columns:1fr; }
    .empty, .error { border:1px solid var(--line); border-radius:22px; padding:28px; background:rgba(16,27,45,.72); }
    .error { border-color:rgba(255,107,122,.45); color:#ffd6dc; }
    .footer { color:var(--muted); font-size:12px; margin-top:18px; }
    @media (max-width: 1100px) { .hero, .content { grid-template-columns:1fr; } .command-primary, .advanced-grid { grid-template-columns:1fr 1fr; } .play-card { grid-template-columns:42px 1fr; } .metric, .actions, .research-box, .reasons { grid-column:1 / -1; text-align:left; } }
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <section class="hero-copy">
        <div class="eyebrow">Sharp Plays Command Center</div>
        <h1>Fast bet/pass triage with queued agent validation.</h1>
        <p class="lede">Premium hybrid shell with sports-trading density. Scan ${escapeHtml(scannedBooks.join(' + '))} together, sort actionable plays first, and persist placed / hidden / pass decisions so the same rows stop wasting attention.</p>
        <div class="hero-meta">
          <span>${escapeHtml((filters.leagues || []).join(' / ') || 'All leagues')}</span>
          <span>${escapeHtml((filters.markets || []).join(' / ') || 'Moneyline')}</span>
          <span>last refresh ${escapeHtml(fetchedAtText)}</span>
          <span>${escapeHtml(fetchDuration)}</span>
          <span>${escapeHtml(meta.scannedQueryCount ?? 0)} queries / ${escapeHtml(meta.scannedRowCount ?? 0)} rows</span>
        </div>
      </section>
      <section class="hero-stats">
        <div class="stat"><strong>${escapeHtml(heroStats.actionableNow)}</strong><span>Actionable now</span></div>
        <div class="stat"><strong>${escapeHtml(heroStats.researchQueued)}</strong><span>Research queued/running</span></div>
        <div class="stat"><strong>${escapeHtml(heroStats.researchDoneNeedsDecision)}</strong><span>Research done / needs decision</span></div>
        <div class="stat"><strong>${escapeHtml(heroStats.hiddenOrPlaced)}</strong><span>Hidden / placed</span></div>
      </section>
    </header>
    ${renderFilters(filters)}
    <div class="content">
      <section>
        ${error ? `<section class="error"><h2>Refresh failed</h2><pre>${escapeHtml(error.stack || error.message || error)}</pre></section>` : ''}
        ${filtered.length ? `<section class="board">${filtered.map((play, index) => renderPlayCard(play, index, { filters, researchEntries, decisionEntries })).join('')}</section>` : renderEmpty(snapshot, filters)}
      </section>
      ${renderResearchQueuePanel(researchList, decisionEntries, diagnostics, filters)}
    </div>
    <div class="footer">JSON API: <a href="/api/plays?${escapeHtml(qs)}">/api/plays</a>. Research queue: <a href="/api/research">/api/research</a>. Decisions: <a href="/api/decisions">/api/decisions</a>. Force refresh: <a href="/refresh?${escapeHtml(qs)}">/refresh</a>.</div>
  </main>
</body>
</html>`;
}


async function refreshSnapshot({ client, filters, force = false } = {}) {
  const key = JSON.stringify(filters || {});
  if (!force && lastSnapshotByFilters.has(key)) return lastSnapshotByFilters.get(key);
  if (!force && lastRefreshPromises.has(key)) return lastRefreshPromises.get(key);
  const promise = fetchSharpPlays({ client, filters })
    .then((snapshot) => {
      lastSnapshot = snapshot;
      lastSnapshotByFilters.set(key, snapshot);
      return snapshot;
    })
    .finally(() => {
      lastRefreshPromises.delete(key);
    });
  lastRefreshPromises.set(key, promise);
  return promise;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function findPlayByResearchId(snapshot, id) {
  const plays = Array.isArray(snapshot?.result) ? snapshot.result : [];
  return plays.find((play) => getPlayResearchId(play) === id) || null;
}

function createSharpPlaysDashboardServer({ client = createPropProfessorClient(), researchQueue = createResearchQueue(), decisionStore = createDecisionStore() } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const filters = normalizeDashboardFilters(url);
    try {
      if (url.pathname === '/api/plays') {
        const snapshot = await refreshSnapshot({ client, filters, force: url.searchParams.get('force') === '1' });
        sendJson(res, 200, { ...snapshot, research: researchQueue.list(), decisions: decisionStore.list() });
        return;
      }
      if (url.pathname === '/api/research') {
        sendJson(res, 200, { ok: true, items: researchQueue.list() });
        return;
      }
      if (url.pathname === '/api/research-env') {
        sendJson(res, 200, { ok: true, diagnostics: buildResearchDiagnostics() });
        return;
      }
      if (url.pathname === '/api/decisions') {
        sendJson(res, 200, { ok: true, items: decisionStore.list() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/actions/research-play') {
        const form = await parseFormBody(req);
        let play = null;
        const rawPlay = form.get('play');
        if (rawPlay) play = JSON.parse(rawPlay);
        const playId = form.get('playId') || form.get('id');
        if (!play && playId) play = findPlayByResearchId(lastSnapshot, playId);
        if (!play) throw new Error('Missing play payload for research queue');
        researchQueue.enqueue(play, filters);
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/actions/research-clear') {
        const form = await parseFormBody(req);
        const id = String(form.get('id') || '').trim();
        if (!id) throw new Error('Missing research id');
        researchQueue.clear(id);
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/actions/research-requeue') {
        const form = await parseFormBody(req);
        const id = String(form.get('id') || '').trim();
        if (!id) throw new Error('Missing research id');
        researchQueue.requeue(id);
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/actions/research-clear-failed') {
        researchQueue.clearFailed();
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/actions/play-decision') {
        const form = await parseFormBody(req);
        const rawPlay = form.get('play');
        const play = rawPlay ? JSON.parse(rawPlay) : (form.get('playId') ? findPlayByResearchId(lastSnapshot, form.get('playId')) : null);
        const id = String(form.get('id') || (play ? getDecisionIdForPlay(play) : '') || '').trim();
        if (!id) throw new Error('Missing decision id');
        const status = String(form.get('status') || '').trim().toLowerCase();
        const note = String(form.get('note') || '').trim();
        if (status === 'cleared' || !status) {
          decisionStore.clear(id);
        } else {
          decisionStore.set(id, { status, note, play, filters });
        }
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (url.pathname === '/refresh') {
        await refreshSnapshot({ client, filters, force: true });
        res.writeHead(302, { location: `/?${buildQueryString(filters)}` });
        res.end();
        return;
      }
      if (url.pathname !== '/') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const snapshot = await refreshSnapshot({ client, filters, force: url.searchParams.get('force') === '1' });
      const researchEntries = Object.fromEntries(researchQueue.list().map((entry) => [entry.id, entry]));
      const decisionEntries = Object.fromEntries(decisionStore.list().map((entry) => [entry.id, entry]));
      const diagnostics = buildResearchDiagnostics();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(renderPage({ snapshot, filters, researchEntries, decisionEntries, diagnostics }));
    } catch (error) {
      if (url.pathname === '/api/plays') {
        sendJson(res, 500, { ok: false, error: error.message, stack: error.stack, filters });
        return;
      }
      if (url.pathname === '/api/research') {
        sendJson(res, 500, { ok: false, error: error.message, stack: error.stack });
        return;
      }
      if (url.pathname === '/api/decisions') {
        sendJson(res, 500, { ok: false, error: error.message, stack: error.stack });
        return;
      }
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(renderPage({ snapshot: lastSnapshot, filters, error, diagnostics: buildResearchDiagnostics() }));
    }
  });
}

function parseDashboardArgv(argv = process.argv) {
  const args = argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--port') {
      options.port = parseNumber(next, DEFAULT_PORT);
      i += 1;
    } else if (arg === '--book') {
      options.book = next;
      i += 1;
    } else if (arg === '--leagues') {
      options.leagues = next;
      i += 1;
    } else if (arg === '--markets' || arg === '--market') {
      options.markets = next;
      i += 1;
    } else if (arg === '--broad') {
      options.broad = '1';
    } else if (arg === '--include-passes') {
      options.includePasses = '1';
    }
  }
  return options;
}

async function main({ argv = process.argv, logger = console } = {}) {
  const options = parseDashboardArgv(argv);
  const port = options.port || Number(process.env.PP_SHARP_PLAYS_DASHBOARD_PORT) || DEFAULT_PORT;
  const server = createSharpPlaysDashboardServer();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  logger.log(`PP Sharp Plays dashboard running at http://127.0.0.1:${port}/?${buildQueryString(normalizeDashboardFilters(options))}`);
  return server;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BOOK,
  DEFAULT_TARGET_BOOKS,
  DEFAULT_PORT,
  DEFAULT_DECISION_STATE_PATH,
  DEFAULT_REFRESH_SECONDS,
  DEFAULT_RESEARCH_STATE_PATH,
  LEAGUE_OPTIONS,
  MARKET_OPTIONS,
  TARGET_BOOK_OPTIONS,
  buildQueryString,
  buildResearchPayload,
  buildResearchPrompt,
  buildResearchChildEnv,
  cleanResearchSummary,
  createDecisionStore,
  createResearchQueue,
  createSharpPlaysDashboardServer,
  extractStartTime,
  fetchSharpPlays,
  formatOdds,
  formatStartTime,
  formatTimeUntil,
  buildResearchDiagnostics,
  getHeroStats,
  getMovementNote,
  getPlayActionVerdict,
  getPlayResearchId,
  getPriceStatus,
  getResearchCounts,
  getResearchRiskFlags,
  getTimeBucket,
  isPidAlive,
  isTennisPlay,
  main,
  normalizeBookName,
  normalizeDashboardFilters,
  parseDashboardArgv,
  parseResearchVerdict,
  renderFilters,
  renderPage
};
