import React, { createContext, useContext, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { formatInTimezone } from "@/lib/timezone-utils";

interface TimezoneContextValue {
  timezone: string;
  /** Format a date as "Jan 1, 2025, 14:30" in the admin's configured timezone */
  formatDateTime: (date: string | Date) => string;
  /** Format a date as "Jan 1, 2025" (date only) in the admin's configured timezone */
  formatDate: (date: string | Date) => string;
  /** Format a date as "14:30" (time only) in the admin's configured timezone */
  formatTime: (date: string | Date) => string;
}

const TimezoneContext = createContext<TimezoneContextValue | null>(null);

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const timezone = user?.timezone ?? "UTC";

  const formatDateTime = useCallback(
    (date: string | Date) =>
      formatInTimezone(date, timezone, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [timezone],
  );

  const formatDate = useCallback(
    (date: string | Date) =>
      formatInTimezone(date, timezone, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [timezone],
  );

  const formatTime = useCallback(
    (date: string | Date) =>
      formatInTimezone(date, timezone, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [timezone],
  );

  return (
    <TimezoneContext.Provider value={{ timezone, formatDateTime, formatDate, formatTime }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): TimezoneContextValue {
  const ctx = useContext(TimezoneContext);
  if (!ctx) throw new Error("useTimezone must be used within TimezoneProvider");
  return ctx;
}
