/**
 * Global app logger – monitors success/error actions and API calls.
 * Works outside React (e.g. in api.ts). React subscribes via LogContext.
 */

export type LogLevel = 'debug' | 'info' | 'success' | 'error';

export type LogEntry = {
  id: string;
  level: LogLevel;
  action: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string; // ISO
  durationMs?: number;
};

const MAX_ENTRIES = 1000;
const listeners = new Set<() => void>();
let entries: LogEntry[] = [];

function emit() {
  listeners.forEach((cb) => cb());
}

function addEntry(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  const full: LogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
  };
  entries = [full, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function getLogEntries(): LogEntry[] {
  return [...entries];
}

export function clearLogs(): void {
  entries = [];
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Log a successful action (e.g. "Login", "Create company") */
export function logSuccess(action: string, message: string, meta?: Record<string, unknown>): void {
  addEntry({ level: 'success', action, message, meta });
}

/** Log a failed action */
export function logError(action: string, message: string, meta?: Record<string, unknown>): void {
  addEntry({ level: 'error', action, message, meta });
}

/** Log generic info (e.g. app init) */
export function logInfo(action: string, message: string, meta?: Record<string, unknown>): void {
  addEntry({ level: 'info', action, message, meta });
}

/** Log debug details (e.g. API request/response) */
export function logDebug(action: string, message: string, meta?: Record<string, unknown>): void {
  addEntry({ level: 'debug', action, message, meta });
}

/** Log an API request (call at start of request) */
export function logApiRequest(method: string, path: string, meta?: Record<string, unknown>): void {
  addEntry({
    level: 'debug',
    action: 'API',
    message: `${method} ${path}`,
    meta: { method, path, ...meta },
  });
}

/** Log an API response (call after request; durationMs optional) */
export function logApiResponse(
  method: string,
  path: string,
  status: number,
  success: boolean,
  durationMs?: number,
  meta?: Record<string, unknown>
): void {
  const level = success ? 'success' : 'error';
  const message = success
    ? `${method} ${path} → ${status} (${durationMs != null ? `${durationMs}ms` : 'ok'})`
    : `${method} ${path} → ${status} failed`;
  addEntry({
    level,
    action: 'API',
    message,
    meta: { method, path, status, durationMs, ...meta },
    durationMs,
  });
}
