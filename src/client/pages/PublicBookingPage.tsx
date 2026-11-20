import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ShieldAlert,
  Video,
} from 'lucide-react';
import {
  DAY_SHORT_NAMES,
  LOCATION_LABELS,
  type EventType,
  type PublicHostBundle,
  type TimeFormat,
  type TimeSlot,
} from '../../shared/types';
import {
  formatDateLong,
  formatMonthYear,
  formatSlotTime,
  getMonthDateBounds,
  pad2,
  utcMsToZonedParts,
} from '../../shared/scheduling';
import { getLocalTimeZone } from '../../shared/timezones';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { api } from '../lib/api';

interface PublicBookingPageProps {
  username: string;
  eventSlug?: string;
  isOwnerLoggedIn: boolean;
  navigate: (path: string) => void;
}

export const PublicBookingPage: React.FC<PublicBookingPageProps> = ({
  username,
  eventSlug,
  isOwnerLoggedIn,
  navigate,
}) => {
  const [bundle, setBundle] = useState<PublicHostBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking scheduler state
  const [viewerTz, setViewerTz] = useState(getLocalTimeZone());
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('12h');
  const todayParts = useMemo(() => utcMsToZonedParts(Date.now(), viewerTz), [viewerTz]);
  const [viewYear, setViewYear] = useState(todayParts.year);
  const [viewMonth0, setViewMonth0] = useState(todayParts.month - 1);
  const [slotsByDate, setSlotsByDate] = useState<Record<string, TimeSlot[]>>({});
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedYmd, setSelectedYmd] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  // Attendee form state
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [attendeeNotes, setAttendeeNotes] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .getPublicHost(username)
      .then((res) => {
        if (!active) return;
        setBundle(res);
        setTimeFormat(res.profile.timeFormat || '12h');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Host not found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [username]);

  const activeEvent: EventType | null = useMemo(() => {
    if (!bundle || !eventSlug) return null;
    return bundle.eventTypes.find((e) => e.slug === eventSlug) ?? null;
  }, [bundle, eventSlug]);

  const monthBounds = useMemo(
    () => getMonthDateBounds(viewYear, viewMonth0),
    [viewYear, viewMonth0],
  );

  // Fetch available slots whenever month, eventSlug, or viewerTz changes
  useEffect(() => {
    if (!bundle || !eventSlug || !activeEvent) return;
    let active = true;
    setSlotsLoading(true);
    api
      .getPublicSlots(
        username,
        eventSlug,
        monthBounds.startYmd,
        monthBounds.endYmd,
        viewerTz,
      )
      .then((res) => {
        if (!active) return;
        setSlotsByDate(res.slots);
        const dates = Object.keys(res.slots).sort();
        if (!selectedYmd || !res.slots[selectedYmd]?.length) {
          setSelectedYmd(dates[0] || '');
        }
      })
      .catch(() => {
        if (active) setSlotsByDate({});
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bundle, username, eventSlug, activeEvent, monthBounds.startYmd, monthBounds.endYmd, viewerTz]);

  const changeMonth = (delta: number) => {
    const dt = new Date(Date.UTC(viewYear, viewMonth0 + delta, 1));
    setViewYear(dt.getUTCFullYear());
    setViewMonth0(dt.getUTCMonth());
    setSelectedSlot(null);
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !selectedSlot) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await api.createPublicBooking(username, {
        eventTypeSlug: activeEvent.slug,
        startUtc: selectedSlot.startUtc,
        attendeeName,
        attendeeEmail,
        attendeeTimezone: viewerTz,
        attendeeNotes,
        customAnswers,
      });
      // Navigate to confirmation page carrying management tokens in query params
      const qs = new URLSearchParams({
        cancelToken: res.booking.cancelToken,
        rescheduleToken: res.booking.rescheduleToken,
      });
      navigate(`/booking/${res.booking.uid}?${qs.toString()}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to book this slot.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
        <div className="text-sm text-gray-500">Loading booking page...</div>
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
        <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-3">
          <h1 className="text-lg font-semibold text-gray-900">Page not found</h1>
          <p className="text-xs text-gray-500">{error || `Could not find @${username}.`}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const { profile, eventTypes } = bundle;
  const initials = profile.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  // ---- View 1: Host Profile Page (/:username) ----
  if (!eventSlug) {
    return (
      <div className="min-h-screen bg-[#fafafa] px-4 py-10 sm:py-16">
        <div className="max-w-2xl mx-auto space-y-8">
          {!isEmbed && isOwnerLoggedIn && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => navigate('/event-types')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
              </button>
            </div>
          )}

          <div className="text-center space-y-3">
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white shadow-sm"
              style={{ backgroundColor: profile.avatarColor || '#ea580c' }}
            >
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">{profile.name}</h1>
              <p className="text-xs font-mono text-gray-400">@{profile.username}</p>
            </div>
            {profile.bio && (
              <p className="text-sm text-gray-600 max-w-md mx-auto leading-relaxed">
                {profile.bio}
              </p>
            )}
          </div>

          {eventTypes.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No public event types available yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
              {eventTypes.map((et) => (
                <button
                  key={et.id}
                  type="button"
                  onClick={() => navigate(`/${profile.username}/${et.slug}`)}
                  className="w-full text-left p-5 hover:bg-gray-50 transition flex items-center justify-between gap-4 group"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: et.color || '#111827' }}
                      />
                      <span className="text-base font-semibold text-gray-900 group-hover:text-black">
                        {et.title}
                      </span>
                    </div>
                    {et.description && (
                      <p className="text-xs text-gray-500 line-clamp-2">{et.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 font-medium">
                        <Clock className="h-3 w-3" /> {et.durationMinutes}m
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5">
                        <Video className="h-3 w-3" /> {LOCATION_LABELS[et.locationType]}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-900 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {!isEmbed && (
            <div className="text-center text-[11px] text-gray-400">
              Powered by EdgeCal · Native Cloudflare Workers &amp; Durable Objects
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- View 2: Event Type Scheduler (/:username/:slug) ----
  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
        <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-3">
          <h1 className="text-lg font-semibold text-gray-900">Event not found</h1>
          <p className="text-xs text-gray-500">
            This booking link does not exist or is currently hidden.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/${profile.username}`)}
            className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white"
          >
            View all events for {profile.name}
          </button>
        </div>
      </div>
    );
  }

  const daySlots = selectedYmd ? slotsByDate[selectedYmd] || [] : [];
  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < monthBounds.firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= monthBounds.daysInMonth; d++) calendarCells.push(d);

  return (
    <div className={`min-h-screen bg-[#fafafa] ${isEmbed ? 'p-2' : 'px-3 sm:px-6 py-6 sm:py-12'}`}>
      <div className="max-w-5xl mx-auto space-y-4">
        {!isEmbed && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate(`/${profile.username}`)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> All events for {profile.name}
            </button>
            {isOwnerLoggedIn && (
              <button
                type="button"
                onClick={() => navigate('/event-types')}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Dashboard
              </button>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
            {/* Left Info Column */}
            <div className="lg:col-span-4 p-5 sm:p-6 space-y-4 bg-white">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: profile.avatarColor || '#ea580c' }}
                >
                  {initials}
                </div>
                <span className="text-sm font-medium text-gray-600">{profile.name}</span>
              </div>

              <div>
                <h1 className="text-xl font-bold text-gray-900">{activeEvent.title}</h1>
                {activeEvent.description && (
                  <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
                    {activeEvent.description}
                  </p>
                )}
              </div>

              <div className="space-y-2 pt-1 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                  <span>{activeEvent.durationMinutes} minutes</span>
                </div>
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-gray-400 shrink-0" />
                  <span>{LOCATION_LABELS[activeEvent.locationType]}</span>
                </div>
                {activeEvent.requiresConfirmation && (
                  <div className="flex items-center gap-2 text-amber-700">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>Requires host confirmation</span>
                  </div>
                )}
                {selectedSlot && (
                  <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <Calendar className="h-3.5 w-3.5 text-orange-600" />
                      {formatDateLong(selectedSlot.startUtc, viewerTz)}
                    </div>
                    <div className="text-gray-700 font-medium">
                      {formatSlotTime(selectedSlot.startUtc, viewerTz, timeFormat)} –{' '}
                      {formatSlotTime(selectedSlot.endUtc, viewerTz, timeFormat)}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 space-y-1.5">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                  Your Timezone
                </label>
                <TimeZoneSelect value={viewerTz} onChange={setViewerTz} compact />
              </div>
            </div>

            {/* Right Pane: Either Calendar + Slots OR Booking Details Form */}
            {selectedSlot ? (
              <div className="lg:col-span-8 p-5 sm:p-6">
                <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                  <h2 className="text-base font-semibold text-gray-900">Enter Your Details</h2>
                  <button
                    type="button"
                    onClick={() => setSelectedSlot(null)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Change time
                  </button>
                </div>

                <form onSubmit={handleBook} className="space-y-4 pt-4 max-w-lg">
                  {submitError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {submitError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Your Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={attendeeName}
                      onChange={(e) => setAttendeeName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={attendeeEmail}
                      onChange={(e) => setAttendeeEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                    />
                  </div>

                  {activeEvent.customQuestions.map((q) => (
                    <div key={q.id}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        {q.label} {q.required ? '*' : ''}
                      </label>
                      {q.type === 'textarea' ? (
                        <textarea
                          rows={3}
                          required={q.required}
                          value={customAnswers[q.label] || ''}
                          onChange={(e) =>
                            setCustomAnswers((prev) => ({ ...prev, [q.label]: e.target.value }))
                          }
                          placeholder={q.placeholder || ''}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                        />
                      ) : (
                        <input
                          type="text"
                          required={q.required}
                          value={customAnswers[q.label] || ''}
                          onChange={(e) =>
                            setCustomAnswers((prev) => ({ ...prev, [q.label]: e.target.value }))
                          }
                          placeholder={q.placeholder || ''}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Additional Notes
                    </label>
                    <textarea
                      rows={3}
                      value={attendeeNotes}
                      onChange={(e) => setAttendeeNotes(e.target.value)}
                      placeholder="Please share anything that will help prepare for our meeting."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSlot(null)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {submitting
                        ? 'Booking...'
                        : activeEvent.requiresConfirmation
                          ? 'Request Booking'
                          : 'Confirm Booking'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                {/* Monthly Calendar */}
                <div className="md:col-span-7 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">
                      {formatMonthYear(viewYear, viewMonth0)}
                    </h2>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => changeMonth(-1)}
                        className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => changeMonth(1)}
                        className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
                        aria-label="Next month"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-gray-400">
                    {DAY_SHORT_NAMES.map((d) => (
                      <div key={d} className="py-1 uppercase">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1.5">
                    {calendarCells.map((day, idx) => {
                      if (day === null) return <div key={`empty-${idx}`} />;
                      const ymd = `${viewYear}-${pad2(viewMonth0 + 1)}-${pad2(day)}`;
                      const hasSlots = (slotsByDate[ymd]?.length ?? 0) > 0;
                      const isSelected = selectedYmd === ymd;
                      const isToday = ymd === todayParts.ymd;

                      return (
                        <button
                          key={ymd}
                          type="button"
                          disabled={!hasSlots}
                          onClick={() => setSelectedYmd(ymd)}
                          className={`relative aspect-square rounded-xl flex items-center justify-center text-xs font-medium transition ${
                            isSelected
                              ? 'bg-gray-900 text-white shadow-xs'
                              : hasSlots
                                ? 'bg-gray-100 text-gray-900 hover:bg-gray-200 font-semibold'
                                : 'text-gray-300 cursor-not-allowed'
                          }`}
                        >
                          {day}
                          {isToday && (
                            <span
                              className={`absolute bottom-1 h-1 w-1 rounded-full ${
                                isSelected ? 'bg-orange-400' : 'bg-orange-500'
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Available Time Slots */}
                <div className="md:col-span-5 p-5 sm:p-6 flex flex-col">
                  <div className="flex items-center justify-between gap-2 pb-3">
                    <span className="text-xs font-semibold text-gray-900">
                      {selectedYmd
                        ? formatDateLong(`${selectedYmd}T12:00:00Z`, 'UTC').replace(/, \d{4}$/, '')
                        : 'Select a date'}
                    </span>
                    <div className="flex rounded-md border border-gray-200 p-0.5 text-[11px]">
                      {(['12h', '24h'] as TimeFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => setTimeFormat(fmt)}
                          className={`px-1.5 py-0.5 rounded ${
                            timeFormat === fmt
                              ? 'bg-gray-900 text-white'
                              : 'text-gray-500 hover:text-gray-900'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="edge-scrollbar flex-1 max-h-[360px] overflow-y-auto space-y-2 pr-1">
                    {slotsLoading ? (
                      <div className="py-10 text-center text-xs text-gray-400">
                        Checking Durable Object availability...
                      </div>
                    ) : daySlots.length === 0 ? (
                      <div className="py-10 text-center text-xs text-gray-400">
                        No available times on this date. Pick a highlighted day on the calendar.
                      </div>
                    ) : (
                      daySlots.map((slot) => (
                        <button
                          key={slot.startUtc}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 px-3 text-xs font-semibold text-gray-900 hover:border-gray-900 hover:bg-gray-900 hover:text-white transition"
                        >
                          {formatSlotTime(slot.startUtc, viewerTz, timeFormat)}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
