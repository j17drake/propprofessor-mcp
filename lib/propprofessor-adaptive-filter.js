'use strict';
const { buildStats } = require('./propprofessor-stats');
const { createMemoryLib } = require('./propprofessor-memory');

function buildAdaptiveFilter(opts = {}) {
  const memory = createMemoryLib();
  const stats = buildStats(memory);
  const minSample = Number.isFinite(Number(opts.minSample)) ? Number(opts.minSample) : 20;
  const since = opts.since || null;

  function apply(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const groupField = options.groupBy || 'league';
    const groups = stats.summarize(since, [groupField, 'market', 'tier']);
    const thresholds = Object.entries(groups.groups).reduce((acc, [field, entries]) => {
      const map = new Map(entries.map((entry) => [entry.key, entry]));
      acc[field] = map;
      return acc;
    }, {});

    return rows.map((row) => {
      const fieldValue = String(row[groupField] || row.league || '').trim();
      const marketValue = String(row.market || '').trim() || String(row.marketType || '').trim();
      const tierValue = String(row.confidenceTier || row.tier || '').trim();
      const bucket = (field, value) => {
        const map = thresholds[field];
        if (!map || !value) return null;
        return map.get(value) || null;
      };
      const leagueBucket = bucket(groupField, fieldValue);
      const marketBucket = bucket('market', marketValue);
      const tierBucket = bucket('tier', tierValue);
      const candidate = leagueBucket || marketBucket || tierBucket;
      const blocked = candidate && candidate.count >= minSample && candidate.roi < 0;
      return {
        ...row,
        adaptiveConfidence: blocked ? 'suppressed' : 'pass',
        suppressed: Boolean(blocked),
        suppressedBy: blocked ? { field: groupField, value: fieldValue, roi: candidate.roi, count: candidate.count } : null
      };
    });
  }

  return { apply, stats };
}

module.exports = { buildAdaptiveFilter };
