import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Video,
  XCircle,
} from 'lucide-react';
import type { HostProfile, PublicBooking, TimeSlot } from '../../shared/types';
import {
  addDaysToYmd,
  formatDateLong,
  formatSlotTime,
  utcMsToZonedParts,
} from '../../shared/scheduling';
import { buildGoogleCalendarUrl } from '../../shared/ics';
import { api } from '../lib/api';

interface BookingManagePageProps {
  uid: string;
  navigate: (path: string) => void;
}

export const BookingManagePage: React.FC<BookingManagePageProps> = ({ uid, navigate }) => {
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [host, setHost] = useState<Omit<HostProfile, 'email'> | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [canReschedule, setCanReschedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = new URLSearchParams(window.location.search);
  const queryCancelToken = params.get('cancelToken') || '';
  const queryRescheduleToken = params.get('rescheduleToken') || '';

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<Record<string, TimeSlot[]>>({});
  const [actionMsg, setActionMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getPublicBooking(uid, {
        cancelToken: queryCancelToken || undefined,
        rescheduleToken: queryRescheduleToken || undefined,
      });
      setBooking(res.booking);
      setHost(res.host);
      setCanCancel(res.canCancel);
      setCanReschedule(res.canReschedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking not found.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [uid]);

  const openReschedule = async () => {
    if (!booking || !host) return;
    setShowReschedule(true);
    const startYmd = utcMsToZonedParts(Date.now(), booking.attendeeTimezone).ymd;
    const endYmd = addDaysToYmd(startYmd, 14);
    const res = await api.getPublicSlots(
      host.username,
      booking.eventTypeSlug,
      startYmd,
      endYmd,
      booking.attendeeTimezone,
      booking.id,
    );
    setRescheduleSlots(res.slots);
  };

  const doReschedule = async (slot: TimeSlot) => {
    if (!booking) return;
    setError('');
    try {
      const res = await api.reschedulePublicBooking(
        booking.uid,
        queryRescheduleToken,
        slot.startUtc,
        booking.attendeeTimezone,
      );
      setBooking(res.booking);
      setShowReschedule(false);
      setActionMsg('Your booking has been rescheduled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule.');
    }
  };

  const doCancel = async () => {
    if (!booking) return;
    setError('');
    try {
      const res = await api.cancelPublicBooking(booking.uid, queryCancelToken, cancelReason);
      setBooking(res.booking);
      setShowCancel(false);
      setActionMsg('Booking cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel booking.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6 text-sm text-gray-500">
        Loading booking...
      </div>
    );
  }

  if (!booking || !host) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
        <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-3">
          <h1 className="text-lg font-semibold text-gray-900">Booking Not Found</h1>
          <p className="text-xs text-gray-500">{error || 'This booking link is invalid.'}</p>
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

  const googleCalUrl = buildGoogleCalendarUrl(booking, host.name);

  return (
    <div className="min-h-screen bg-[#fafafa] px-4 py-10 sm:py-16">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-xs space-y-6">
          {/* Status Header */}
          <div className="text-center space-y-2">
            {booking.status === 'confirmed' ? (
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            ) : booking.status === 'pending' ? (
              <Clock className="mx-auto h-12 w-12 text-amber-500" />
            ) : (
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
            )}

            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              {booking.status === 'confirmed'
                ? 'This meeting is scheduled'
                : booking.status === 'pending'
                  ? 'Booking request sent'
                  : 'This meeting was cancelled'}
            </h1>
            <p className="text-xs text-gray-500">
              {booking.status === 'pending'
                ? `${host.name} needs to confirm this booking before it is finalized.`
                : booking.status === 'cancelled'
                  ? booking.cancellationReason || 'The slot has been released.'
                  : 'A calendar invite (.ics) is ready to download below.'}
            </p>
          </div>

          {actionMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 text-center">
              {actionMsg}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 text-center">
              {error}
            </div>
          )}

          {/* Details Card */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-xs">What</span>
              <span className="font-semibold text-gray-900 text-right">{booking.title}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-xs">When</span>
              <span className="text-right text-gray-800 text-xs font-medium">
                {formatDateLong(booking.startUtc, booking.attendeeTimezone)}
                <br />
                {formatSlotTime(booking.startUtc, booking.attendeeTimezone, host.timeFormat)} –{' '}
                {formatSlotTime(booking.endUtc, booking.attendeeTimezone, host.timeFormat)} (
                {booking.attendeeTimezone})
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-xs">Who</span>
              <span className="text-right text-gray-800 text-xs">
                {host.name} &amp; {booking.attendeeName}
                {booking.attendeeEmail ? ` (${booking.attendeeEmail})` : ''}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 text-xs">Where</span>
              <span className="text-right text-xs">
                {booking.meetingUrl ? (
                  <a
                    href={booking.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                  >
                    <Video className="h-3.5 w-3.5" /> Join Meeting Link
                  </a>
                ) : (
                  booking.locationDisplay
                )}
              </span>
            </div>
          </div>

          {/* Calendar Actions */}
          {booking.status !== 'cancelled' && (
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => api.downloadBookingIcs(booking.uid)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                <Download className="h-3.5 w-3.5" /> Download .ics
              </button>
              <a
                href={googleCalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Add to Google Calendar
              </a>
            </div>
          )}

          {/* Reschedule / Cancel */}
          {booking.status !== 'cancelled' && (
            <div className="border-t border-gray-100 pt-4 flex flex-wrap items-center justify-center gap-4 text-xs">
              {canReschedule && (
                <button
                  type="button"
                  onClick={openReschedule}
                  className="inline-flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900 underline underline-offset-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reschedule
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setShowCancel((s) => !s)}
                  className="inline-flex items-center gap-1 font-medium text-red-600 hover:text-red-700 underline underline-offset-2"
                >
                  <XCircle className="h-3.5 w-3.5" /> Cancel Booking
                </button>
              )}
              {!canReschedule && !canCancel && (
                <p className="text-gray-500 text-center">
                  Use the personal management link from your confirmation email to reschedule or cancel.
                </p>
              )}
            </div>
          )}

          {/* Inline Cancel Form */}
          {showCancel && booking.status !== 'cancelled' && (
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
              <div className="text-xs font-semibold text-red-900">Reason for cancellation</div>
              <textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Optional message..."
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancel(false)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium"
                >
                  Nevermind
                </button>
                <button
                  type="button"
                  onClick={doCancel}
                  className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  Cancel Meeting
                </button>
              </div>
            </div>
          )}

          {/* Inline Reschedule Picker */}
          {showReschedule && booking.status !== 'cancelled' && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Pick a New Time (next 14 days)
                </div>
                <button
                  type="button"
                  onClick={() => setShowReschedule(false)}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  Close
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-3 edge-scrollbar">
                {Object.keys(rescheduleSlots).length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">
                    No alternative slots found in the next 14 days.
                  </p>
                ) : (
                  Object.entries(rescheduleSlots)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([ymd, slots]) => (
                      <div key={ymd} className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-gray-600">{ymd}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {slots.slice(0, 12).map((s) => (
                            <button
                              key={s.startUtc}
                              type="button"
                              onClick={() => doReschedule(s)}
                              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-900 hover:text-white transition"
                            >
                              {formatSlotTime(s.startUtc, booking.attendeeTimezone, host.timeFormat)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate(`/${host.username}`)}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            Book another time with {host.name}
          </button>
        </div>
      </div>
    </div>
  );
};
