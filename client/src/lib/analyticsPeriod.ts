export type AnalyticsPeriod =
  | 'last_hour'
  | 'today'
  | 'yesterday'
  | '3d'
  | '7d'
  | '14d'
  | '30d'
  | '90d';

export const ANALYTICS_PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'last_hour', label: 'Last hour' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = '30d';

export function formatChartDateLabel(date: string, useHourly?: boolean) {
  try {
    const normalized = date.includes(' ') && !date.includes('T') ? date.replace(' ', 'T') : date;
    const d = new Date(normalized);
    if (useHourly || date.includes(':')) {
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return date;
  }
}
