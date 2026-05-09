'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanResearchSummary, isPidAlive } = require('../lib/propprofessor-sharp-plays-dashboard');

const DEFAULT_HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
const DEFAULT_RESEARCH_DIR = process.env.PP_SHARP_PLAYS_RESEARCH_DIR || path.join(DEFAULT_HERMES_HOME, 'propprofessor', 'sharp-play-research');
const STATE_PATH = process.env.PP_SHARP_PLAYS_RESEARCH_STATE || path.join(DEFAULT_RESEARCH_DIR, 'queue.json');
const TIMEOUT_MS = Number(process.env.PP_SHARP_PLAYS_RESEARCH_TIMEOUT_MS) || 5 * 60 * 1000;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function main() {
  const state = readJson(STATE_PATH, { items: {} }) || { items: {} };
  const items = state && typeof state.items === 'object' ? state.items : {};
  const entries = Object.values(items);
  const counts = { queued: 0, researching: 0, done: 0, failed: 0, total: 0 };
  const alive = [];
  const dead = [];
  const stale = [];
  const missingOutput = [];
  const chromeSummaries = [];
  const now = Date.now();

  for (const entry of entries) {
    const status = String(entry?.status || 'queued').toLowerCase();
    if (counts[status] !== undefined) counts[status] += 1;
    counts.total += 1;

    if (status === 'researching') {
      if (isPidAlive(entry.pid)) alive.push(entry.id);
      else dead.push(entry.id);
    }

    const createdAt = Date.parse(entry?.createdAt || '');
    if (['queued', 'researching'].includes(status) && Number.isFinite(createdAt) && now - createdAt > TIMEOUT_MS) stale.push(entry.id);

    if (entry?.outputPath && !fs.existsSync(entry.outputPath)) missingOutput.push(entry.id);

    const summary = cleanResearchSummary(entry?.summary || '');
    if (/Hermes Agent|Resume this session with|hermes --resume/i.test(summary)) chromeSummaries.push(entry.id);
  }

  console.log(`queue path: ${STATE_PATH}`);
  console.log(`counts: queued=${counts.queued} researching=${counts.researching} done=${counts.done} failed=${counts.failed} total=${counts.total}`);
  console.log(`researching pids alive: ${alive.length ? alive.join(', ') : 'none'}`);
  console.log(`researching pids dead: ${dead.length ? dead.join(', ') : 'none'}`);
  console.log(`jobs older than timeout (${Math.round(TIMEOUT_MS / 60000)}m): ${stale.length ? stale.join(', ') : 'none'}`);
  console.log(`output files missing: ${missingOutput.length ? missingOutput.join(', ') : 'none'}`);
  console.log(`summaries containing Hermes chrome: ${chromeSummaries.length ? chromeSummaries.join(', ') : 'none'}`);
}

if (require.main === module) main();

module.exports = { main };
