import React, { useEffect, useState } from 'react';
import { CalendarOff, Check, Copy, Plus, Star, Trash2 } from 'lucide-react';
import {
  DAY_NAMES,
  type AvailabilitySchedule,
  type TimeRange,
} from '../../shared/types';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { api } from '../lib/api';

export const AvailabilityPage: React.FC = () => {
  const [schedules, setSchedules] = useState<AvailabilitySchedule[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // Date override form state
  const [ovrDate, setOvrDate] = useState('');
  const [ovrUnavailable, setOvrUnavailable] = useState(true);
  const [ovrStart, setOvrStart] = useState('10:00');
  const [ovrEnd, setOvrEnd] = useState('14:00');
  const [ovrLabel, setOvrLabel] = useState('');

  const load = async (preserveId?: string) => {
    setLoading(true);
    try {
      const res = await api.listSchedules();
      setSchedules(res.schedules);
      const target =
        res.schedules.find((s) => s.id === (preserveId || selectedId)) ?? res.schedules[0];
      if (target) setSelectedId(target.id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const current = schedules.find((s) => s.id === selectedId) ?? schedules[0];

  const updateCurrentLocal = (patch: Partial<AvailabilitySchedule>) => {
    if (!current) return;
    setSchedules((prev) => prev.map((s) => (s.id === current.id ? { ...s, ...patch } : s)));
  };

  const saveCurrent = async () => {
    if (!current) return;
    setSaving(true);
    setSavedMsg('');
    try {
      await api.updateSchedule(current.id, {
        name: current.name,
        timezone: current.timezone,
        isDefault: current.isDefault,
        weeklyHours: current.weeklyHours,
      });
      setSavedMsg('Saved to Durable Object');
      setTimeout(() => setSavedMsg(''), 2200);
      await load(current.id);
    } finally {
      setSaving(false);
    }
  };

  const createNewSchedule = async () => {
    const name = window.prompt('Name for new availability schedule:', 'Evening / Consulting Hours');
    if (!name) return;
    const res = await api.createSchedule({ name });
    await load(res.schedule.id);
  };

  const deleteCurrent = async () => {
    if (!current || schedules.length <= 1) return;
    if (!window.confirm(`Delete schedule "${current.name}"?`)) return;
    await api.deleteSchedule(current.id);
    await load();
  };

  const setDayRanges = (day: number, ranges: TimeRange[]) => {
    if (!current) return;
    updateCurrentLocal({
      weeklyHours: {
        ...current.weeklyHours,
        [day]: ranges,
      },
    });
  };

  const copyMondayToWeekdays = () => {
    if (!current) return;
    const mon = current.weeklyHours[1] || [];
    const next = { ...current.weeklyHours };
    for (const d of [2, 3, 4, 5]) {
      next[d] = mon.map((r) => ({ ...r }));
    }
    updateCurrentLocal({ weeklyHours: next });
  };

  const addOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || !ovrDate) return;
    await api.upsertDateOverride(current.id, {
      dateYmd: ovrDate,
      unavailable: ovrUnavailable,
      ranges: ovrUnavailable ? [] : [{ start: ovrStart, end: ovrEnd }],
      label: ovrLabel,
    });
    setOvrDate('');
    setOvrLabel('');
    await load(current.id);
  };

  const removeOverride = async (id: string) => {
    if (!current) return;
    await api.deleteDateOverride(id);
    await load(current.id);
  };

  if (loading || !current) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Loading availability schedules...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Availability
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure recurring weekly hours and specific date overrides.
          </p>
        </div>
        <button
          type="button"
          onClick={createNewSchedule}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
          <Plus className="h-3.5 w-3.5" /> New Schedule
        </button>
      </div>

      {/* Schedule Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {schedules.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelectedId(s.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              s.id === current.id
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>{s.name}</span>
            {s.isDefault && <Star className="h-3 w-3 fill-current" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Hours Card */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 space-y-5 shadow-xs">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 pb-4">
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="block text-xs font-medium text-gray-600">Schedule Name</label>
              <input
                type="text"
                value={current.name}
                onChange={(e) => updateCurrentLocal({ name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium"
              />
            </div>

            <div className="flex items-center gap-2">
              {!current.isDefault && (
                <button
                  type="button"
                  onClick={() => updateCurrentLocal({ isDefault: true })}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Set Default
                </button>
              )}
              {schedules.length > 1 && (
                <button
                  type="button"
                  onClick={deleteCurrent}
                  className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                  title="Delete schedule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Weekly Hours
            </span>
            <button
              type="button"
              onClick={copyMondayToWeekdays}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <Copy className="h-3.5 w-3.5" /> Copy Monday to Tue–Fri
            </button>
          </div>

          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const ranges = current.weeklyHours[day] || [];
              const enabled = ranges.length > 0;
              return (
                <div
                  key={day}
                  className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/70 px-3.5 py-2.5"
                >
                  <label className="flex items-center gap-2.5 pt-1 text-sm font-medium text-gray-800 w-32 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() =>
                        setDayRanges(day, enabled ? [] : [{ start: '09:00', end: '17:00' }])
                      }
                      className="h-4 w-4 rounded accent-gray-900"
                    />
                    <span>{DAY_NAMES[day]}</span>
                  </label>

                  <div className="flex-1 space-y-2">
                    {!enabled ? (
                      <div className="pt-1 text-xs text-gray-400">Unavailable</div>
                    ) : (
                      ranges.map((r, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-2">
                          <input
                            type="time"
                            value={r.start}
                            onChange={(e) => {
                              const next = ranges.map((x, i) =>
                                i === idx ? { ...x, start: e.target.value } : x,
                              );
                              setDayRanges(day, next);
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs"
                          />
                          <span className="text-gray-400 text-xs">–</span>
                          <input
                            type="time"
                            value={r.end}
                            onChange={(e) => {
                              const next = ranges.map((x, i) =>
                                i === idx ? { ...x, end: e.target.value } : x,
                              );
                              setDayRanges(day, next);
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs"
                          />
                          {idx === 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDayRanges(day, [...ranges, { start: '18:00', end: '20:00' }])
                              }
                              title="Add split time range"
                              className="rounded-lg p-1 text-gray-500 hover:bg-gray-200"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setDayRanges(
                                  day,
                                  ranges.filter((_, i) => i !== idx),
                                )
                              }
                              title="Remove range"
                              className="rounded-lg p-1 text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
              {savedMsg && (
                <>
                  <Check className="h-3.5 w-3.5" /> {savedMsg}
                </>
              )}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={saveCurrent}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Availability'}
            </button>
          </div>
        </div>

        {/* Right column: Timezone + Date Overrides */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 shadow-xs">
            <h2 className="text-sm font-semibold text-gray-900">Schedule Timezone</h2>
            <TimeZoneSelect
              value={current.timezone}
              onChange={(tz) => updateCurrentLocal({ timezone: tz })}
            />
            <p className="text-[11px] text-gray-500">
              Attendees automatically see available times converted to their own local timezone.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <CalendarOff className="h-4 w-4 text-gray-500" />
                Date Overrides
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Block vacations or set special hours on specific dates.
              </p>
            </div>

            <form onSubmit={addOverride} className="space-y-3 border-b border-gray-100 pb-4">
              <input
                type="date"
                required
                value={ovrDate}
                onChange={(e) => setOvrDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
              />
              <input
                type="text"
                value={ovrLabel}
                onChange={(e) => setOvrLabel(e.target.value)}
                placeholder="Label (e.g., Holiday, Half-day)"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
              />
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ovrUnavailable}
                  onChange={(e) => setOvrUnavailable(e.target.checked)}
                  className="accent-gray-900"
                />
                Mark entire day unavailable
              </label>

              {!ovrUnavailable && (
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="time"
                    value={ovrStart}
                    onChange={(e) => setOvrStart(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1"
                  />
                  <span>–</span>
                  <input
                    type="time"
                    value={ovrEnd}
                    onChange={(e) => setOvrEnd(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1"
                  />
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Add Date Override
              </button>
            </form>

            {current.dateOverrides.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">No date overrides yet.</p>
            ) : (
              <div className="space-y-2">
                {current.dateOverrides.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-medium text-gray-900">
                        {o.dateYmd} {o.label ? `· ${o.label}` : ''}
                      </div>
                      <div className="text-gray-500">
                        {o.unavailable
                          ? 'Unavailable all day'
                          : o.ranges.map((r) => `${r.start}–${r.end}`).join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOverride(o.id)}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
