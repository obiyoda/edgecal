import React, { useMemo, useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { getAllTimeZones, getTimeZoneLabel } from '../../shared/timezones';

interface TimeZoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  compact?: boolean;
}

export const TimeZoneSelect: React.FC<TimeZoneSelectProps> = ({ value, onChange, compact }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const allZones = useMemo(() => getAllTimeZones(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allZones.slice(0, 60);
    return allZones.filter((z) => z.toLowerCase().includes(q)).slice(0, 60);
  }, [allZones, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-white text-left text-gray-800 hover:bg-gray-50 transition ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'w-full px-3 py-2 text-sm'
        }`}
      >
        <Globe className="h-4 w-4 shrink-0 text-gray-500" />
        <span className="truncate flex-1">{getTimeZoneLabel(value)}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-40 mt-1.5 min-w-[260px] rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city or timezone..."
                autoFocus
                className="w-full text-xs outline-none placeholder:text-gray-400"
              />
            </div>
            <div className="edge-scrollbar max-h-60 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-400">No timezones found</div>
              ) : (
                filtered.map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => {
                      onChange(tz);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      tz === value
                        ? 'bg-gray-900 text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {getTimeZoneLabel(tz)}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
