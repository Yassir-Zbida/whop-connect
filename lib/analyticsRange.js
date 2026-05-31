const VALID_PRESETS = new Set([
  'last_hour',
  'today',
  'yesterday',
  '3d',
  '7d',
  '14d',
  '30d',
  '90d',
]);

/**
 * Resolve analytics time window for SQL filters and chart grouping.
 * @param {string} period
 */
export function resolveAnalyticsPeriod(period) {
  switch (period) {
    case 'last_hour':
      return {
        period: 'last_hour',
        displayDays: null,
        useHourly: true,
        timeWhere: 'created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)',
        timeWhereNow: 'created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)',
        timeParams: [],
        dateGroup: "DATE_FORMAT(created_at, '%Y-%m-%d %H:00')",
      };
    case 'today':
      return {
        period: 'today',
        displayDays: null,
        useHourly: true,
        timeWhere:
          'created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)',
        timeWhereNow:
          'created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)',
        timeParams: [],
        dateGroup: "DATE_FORMAT(created_at, '%Y-%m-%d %H:00')",
      };
    case 'yesterday':
      return {
        period: 'yesterday',
        displayDays: null,
        useHourly: true,
        timeWhere:
          'created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()',
        timeWhereNow:
          'created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()',
        timeParams: [],
        dateGroup: "DATE_FORMAT(created_at, '%Y-%m-%d %H:00')",
      };
    default: {
      const m = String(period).match(/^(\d+)d$/);
      const days = m
        ? Math.min(Math.max(Number(m[1]), 1), 90)
        : period === '3d'
          ? 3
          : 30;
      return {
        period: `${days}d`,
        displayDays: days,
        useHourly: false,
        timeWhere: 'created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
        timeWhereNow: 'created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)',
        timeParams: [days],
        dateGroup: 'DATE(created_at)',
      };
    }
  }
}

/**
 * @param {string | number | undefined | null} input - period preset or legacy days number
 */
export function parseAnalyticsPeriod(input) {
  if (input == null || input === '') return resolveAnalyticsPeriod('30d');
  const s = String(input).trim().toLowerCase();
  if (VALID_PRESETS.has(s)) return resolveAnalyticsPeriod(s);
  if (/^\d+d$/.test(s)) {
    const days = Math.min(Math.max(parseInt(s, 10), 1), 90);
    return resolveAnalyticsPeriod(`${days}d`);
  }
  if (/^\d+$/.test(s)) {
    const days = Math.min(Math.max(Number(s), 1), 90);
    return resolveAnalyticsPeriod(`${days}d`);
  }
  return resolveAnalyticsPeriod('30d');
}

/** @param {ReturnType<typeof resolveAnalyticsPeriod>} range */
export function sqlTimeFilter(range, column = 'created_at') {
  return range.timeWhere.replace(/created_at/g, column);
}

/** @param {ReturnType<typeof resolveAnalyticsPeriod>} range */
export function sqlTimeFilterNow(range, column = 'created_at') {
  const clause = range.timeWhereNow || range.timeWhere;
  return clause.replace(/created_at/g, column);
}

/** @param {ReturnType<typeof resolveAnalyticsPeriod>} range */
export function sqlDateGroup(range, column = 'created_at') {
  return range.dateGroup.replace(/created_at/g, column);
}

/** @param {ReturnType<typeof resolveAnalyticsPeriod>} range */
export function rangeQueryParams(range, ...extra) {
  return [...extra, ...range.timeParams];
}
