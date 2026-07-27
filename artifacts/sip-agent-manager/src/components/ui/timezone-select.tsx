import React, { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIMEZONES_LIST, getTimezoneLabel, getOffsetHours } from "@/lib/timezone-utils";

interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
}

const ITEM_HEIGHT = 36; // px per row
const VISIBLE_ROWS = 10;

export function TimezoneSelect({ value, onChange, className }: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sort once by current UTC offset (DST-aware), memoised — offsets only change at DST boundaries
  const sortedTimezones = useMemo(() => {
    return [...TIMEZONES_LIST].sort((a, b) => getOffsetHours(a.tz) - getOffsetHours(b.tz));
  }, []);

  // Filter by search query (matches GMT offset string or city name)
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sortedTimezones;
    return sortedTimezones.filter((entry) => {
      const label = getTimezoneLabel(entry).toLowerCase();
      return label.includes(q) || entry.tz.toLowerCase().includes(q);
    });
  }, [search, sortedTimezones]);

  // Current entry for display in the button
  const currentEntry = useMemo(
    () => TIMEZONES_LIST.find((e) => e.tz === value),
    [value],
  );
  const currentLabel = currentEntry ? getTimezoneLabel(currentEntry) : value;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input when opened, scroll selected item into view
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    // Scroll selected item into view
    const idx = filtered.findIndex((e) => e.tz === value);
    if (idx >= 0 && listRef.current) {
      listRef.current.scrollTop = Math.max(0, idx * ITEM_HEIGHT - ITEM_HEIGHT * 2);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (tz: string) => {
    onChange(tz);
    setOpen(false);
    setSearch("");
  };

  const listHeight = Math.min(filtered.length, VISIBLE_ROWS) * ITEM_HEIGHT;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
          open && "ring-2 ring-ring",
        )}
      >
        <span className="truncate font-mono text-xs">{currentLabel}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-md"
          style={{ minWidth: "100%" }}
        >
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezone…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Scrollable list — exactly VISIBLE_ROWS items visible */}
          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ height: listHeight || ITEM_HEIGHT }}
          >
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-9 text-sm text-muted-foreground">
                No results
              </div>
            ) : (
              filtered.map((entry) => {
                const label = getTimezoneLabel(entry);
                const isSelected = entry.tz === value;
                return (
                  <button
                    key={entry.tz}
                    type="button"
                    onClick={() => handleSelect(entry.tz)}
                    style={{ height: ITEM_HEIGHT }}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 text-sm hover:bg-accent hover:text-accent-foreground transition-colors",
                      isSelected && "bg-accent/60 text-accent-foreground font-medium",
                    )}
                  >
                    <span className="font-mono text-xs truncate">{label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
