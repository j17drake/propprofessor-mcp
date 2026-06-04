'use strict';
const { createMemoryLib } = require('./propprofessor-memory');

function buildStats(memory) {
  memory = memory || createMemoryLib();

  function load(since) {
    return memory.query({ since, limit: 50000, type: 'outcome' });
  }

  function groupBy(events, field) {
    const map = new Map();
    for (const event of events) {
      const raw = event[field];
      if (raw == null) continue;
      const key = String(raw).trim();
      if (!key) continue;
      const bucket = map.get(key) || { count: 0, profit: 0, wins: 0, losses: 0, pushes: 0 };
      bucket.count += 1;
      bucket.profit += Number(event.profit) || 0;
      if (event.outcome === 'win') bucket.wins += 1;
      else if (event.outcome === 'loss') bucket.losses += 1;
      else if (event.outcome === 'push') bucket.pushes += 1;
      map.set(key, bucket);
    }
    return map;
  }

  function summarize(since, fields) {
    const events = load(since);
    const summary = { total: events.length, since, fields, groups: {} };
    for (const field of fields) {
      const map = groupBy(events, field);
      const entries = [];
      for (const [key, value] of map.entries()) {
        entries.push({ key, ...value, roi: value.count ? +(value.profit / value.count).toFixed(4) : 0 });
      }
      summary.groups[field] = entries.sort((a, b) => b.profit - a.profit);
    }
    return summary;
  }

  return { load, groupBy, summarize };
}

module.exports = { buildStats };
