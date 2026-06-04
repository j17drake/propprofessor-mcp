'use strict';

const fs = require('fs');
const path = require('path');

function getMemoryDir() {
  const baseDir = process.env.PROPPROFESSOR_MEMORY_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.propprofessor', 'memory');
  return baseDir;
}

function getMemoryFilePath() {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'events.jsonl');
}

function createMemoryLib() {
  return {
    dir: getMemoryDir(),
    file: getMemoryFilePath(),
    append(event) {
      if (!event || typeof event !== 'object') {
        const err = new Error('event must be a non-null object');
        err.code = 'INVALID_EVENT';
        err.category = 'validation';
        err.status = 400;
        throw err;
      }

      if (!event.ts) event.ts = new Date().toISOString();
      if (!event.type) {
        const err = new Error('event.type is required');
        err.code = 'MISSING_TYPE';
        err.category = 'validation';
        err.status = 400;
        throw err;
      }

      const line = JSON.stringify(event);
      fs.appendFileSync(this.file, line + '\n', { encoding: 'utf8' });
    },

    query({ since, until, type, limit = 200 } = {}) {
      if (!fs.existsSync(this.file)) {
        return [];
      }

      const content = fs.readFileSync(this.file, { encoding: 'utf8' });
      const lines = content.split(/\r?\n/).filter((line) => line.trim());

      const events = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          events.push(parsed);
        } catch {
          // ignore malformed lines
        }
      }

      const filtered = events.filter((event) => {
        if (type && event.type !== type) return false;
        if (since && (!event.ts || event.ts < since)) return false;
        if (until && (!event.ts || event.ts > until)) return false;
        return true;
      });

      const sorted = filtered.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
      const sliced = limit ? sorted.slice(-Number(limit)) : sorted;
      return sliced.reverse();
    },

    stats({ since, groupBy } = {}) {
      const events = this.query({ since, limit: 50000 });
      // minimal stats: counts by type, source, and groupBy key
      const counts = new Map();
      for (const event of events) {
        if (groupBy && event[groupBy]) {
          const key = String(event[groupBy]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }

      return {
        total: events.length,
        byType: events.reduce((acc, ev) => {
          acc[ev.type] = (acc[ev.type] || 0) + 1;
          return acc;
        }, {}),
        bySource: events.reduce((acc, ev) => {
          if (ev.source) acc[ev.source] = (acc[ev.source] || 0) + 1;
          return acc;
        }, {}),
        groupBy: groupBy || null,
        groups: Object.fromEntries(counts)
      };
    }
  };
}

module.exports = { createMemoryLib };
