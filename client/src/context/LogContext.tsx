import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  clearLogs as clearLogsStore,
  getLogEntries,
  subscribe,
  type LogEntry,
  type LogLevel,
} from '../utils/logger';

type LogContextValue = {
  entries: LogEntry[];
  clearLogs: () => void;
};

const LogContext = createContext<LogContextValue | null>(null);

export function LogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogEntries());

  useEffect(() => {
    const unsub = subscribe(() => setEntries(getLogEntries()));
    return unsub;
  }, []);

  const clearLogs = useCallback(() => {
    clearLogsStore();
    setEntries([]);
  }, []);

  return (
    <LogContext.Provider value={{ entries, clearLogs }}>
      {children}
    </LogContext.Provider>
  );
}

export function useLogs(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) throw new Error('useLogs must be used within LogProvider');
  return ctx;
}

export type { LogEntry, LogLevel };
