import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  Download,
  ExternalLink,
  Mail,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import type { Booking, HostProfile } from '../../shared/types';
import { formatDateLong, formatSlotTime } from '../../shared/scheduling';
import { api } from '../lib/api';

interface BookingsPageProps {
  profile: HostProfile;
  navigate: (path: string) => void;
  onBookingsChange: () => void;
}

type TabKey = 'upcoming' | 'unconfirmed' | 'past' | 'cancelled';

export const BookingsPage: React.FC<BookingsPageProps> = ({
  profile,
  navigate,
  onBookingsChange,
}) => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listBookings();
      setBookings(res.bookings);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const now = Date.now();
  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const endMs = Date.parse(b.endUtc);
      if (tab === 'cancelled') return b.status === 'cancelled';
      if (tab === 'unconfirmed') return b.status === 'pending' && endMs >= now;
      if (tab === 'past') return b.status !== 'cancelled' && endMs < now;
      return b.status === 'confirmed' && endMs >= now;
    });
  }, [bookings, tab, now]);

  const counts = useMemo(() => {
    return {
      upcoming: bookings.filter((b) => b.status === 'confirmed' && Date.parse(b.endUtc) >= now).length,
      unconfirmed: bookings.filter((b) => b.status === 'pending' && Date.parse(b.endUtc) >= now).length,
      past: bookings.filter((b) => b.status !== 'cancelled' && Date.parse(b.endUtc) < now).length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    };
  }, [bookings, now]);

  const confirm = async (b: Booking) => {
    await api.confirmBooking(b.id);
    await load();
    onBookingsChange();
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    await api.cancelHostBooking(cancelTarget.id, cancelReason);
    setCancelTarget(null);
    setCancelReason('');
    await load();
    onBookingsChange();
  };

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { key: 'unconfirmed', label: 'Unconfirmed', count: counts.unconfirmed },
    { key: 'past', label: 'Past', count: counts.past },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">Bookings</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage confirmed meetings, approve requests, and download calendar invites.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === t.key
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span>{t.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[11px] ${
                tab === t.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading bookings...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center space-y-2">
          <Calendar className="mx-auto h-7 w-7 text-gray-300" />
          <p className="text-sm font-medium text-gray-900">No {tab} bookings</p>
          <p className="text-xs text-gray-500">
            Share your link{' '}
            <button
              type="button"
              onClick={() => navigate(`/${profile.username}`)}
              className="underline font-medium text-gray-800"
            >
              /{profile.username}
            </button>{' '}
            to receive new bookings.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
          {filtered.map((b) => (
            <div
              key={b.id}
              className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 sm:p-5"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{b.eventTypeTitle}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      b.status === 'confirmed'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : b.status === 'pending'
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {b.status === 'pending' ? 'Needs approval' : b.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1 font-medium text-gray-800">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {formatDateLong(b.startUtc, profile.timezone)} ·{' '}
                    {formatSlotTime(b.startUtc, profile.timezone, profile.timeFormat)} –{' '}
                    {formatSlotTime(b.endUtc, profile.timezone, profile.timeFormat)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5 text-gray-400" />
                    {b.attendeeName} ({b.attendeeEmail})
                  </span>
                </div>

                {b.meetingUrl && (
                  <div className="text-xs">
                    <a
                      href={b.meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <Video className="h-3.5 w-3.5" />
                      {b.meetingUrl}
                    </a>
                  </div>
                )}

                {b.attendeeNotes && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100">
                    "{b.attendeeNotes}"
                  </p>
                )}

                {Object.keys(b.customAnswers || {}).length > 0 && (
                  <div className="text-xs text-gray-600 space-y-0.5 pt-0.5">
                    {Object.entries(b.customAnswers).map(([k, v]) =>
                      v ? (
                        <div key={k}>
                          <span className="font-medium text-gray-700">{k}:</span> {v}
                        </div>
                      ) : null,
                    )}
                  </div>
                )}

                {b.cancellationReason && (
                  <p className="text-xs text-red-600">Reason: {b.cancellationReason}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {b.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => confirm(b)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5" /> Confirm
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => api.downloadBookingIcs(b.uid)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5" /> .ics
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const qs = new URLSearchParams({
                      cancelToken: b.cancelToken,
                      rescheduleToken: b.rescheduleToken,
                    });
                    navigate(`/booking/${b.uid}?${qs.toString()}`);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Details
                </button>
                {b.status !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => setCancelTarget(b)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Cancel Booking</h2>
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-gray-600">
              Cancel <strong>{cancelTarget.title}</strong>? The slot will immediately become available again.
            </p>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Optional note for the attendee..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-medium text-gray-700"
              >
                Keep Booking
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
