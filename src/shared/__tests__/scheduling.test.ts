import { describe, expect, it } from 'vitest';
import {
  computeAvailableSlotsByDate,
  isSlotBookable,
  zonedDateTimeToUtcMs,
  utcMsToZonedParts,
} from '../scheduling';
import { generateBookingIcs, generateHostFeedIcs, parseIcsBusyIntervals } from '../ics';
import { hashPassword, signHmacSha256, verifyPassword } from '../../worker/crypto';
import type { AvailabilitySchedule, Booking, EventType } from '../types';

const baseSchedule: AvailabilitySchedule = {
  id: 'sch_1',
  name: 'Working Hours',
  timezone: 'America/New_York',
  isDefault: true,
  weeklyHours: {
    0: [],
    1: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
    2: [{ start: '09:00', end: '17:00' }],
    3: [{ start: '09:00', end: '17:00' }],
    4: [{ start: '09:00', end: '17:00' }],
    5: [{ start: '09:00', end: '17:00' }],
    6: [],
  },
  dateOverrides: [
    {
      id: 'ovr_1',
      scheduleId: 'sch_1',
      dateYmd: '2027-06-15', // Tuesday marked unavailable
      unavailable: true,
      ranges: [],
      label: 'Day Off',
    },
    {
      id: 'ovr_2',
      scheduleId: 'sch_1',
      dateYmd: '2027-06-16', // Wednesday custom half-day
      unavailable: false,
      ranges: [{ start: '10:00', end: '11:00' }],
      label: 'Short Day',
    },
  ],
  createdAt: '2027-01-01T00:00:00.000Z',
};

const baseEvent: EventType = {
  id: 'evt_1',
  slug: '30min',
  title: '30 Min Meeting',
  description: '',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  minimumNoticeMinutes: 60,
  maxFutureDays: 60,
  slotIntervalMinutes: 30,
  locationType: 'jitsi',
  locationValue: '',
  requiresConfirmation: false,
  color: '#111827',
  hidden: false,
  scheduleId: 'sch_1',
  customQuestions: [],
  createdAt: '2027-01-01T00:00:00.000Z',
};

describe('EdgeCal Scheduling Engine', () => {
  it('accurately converts zoned wall-clock time to UTC and back across DST', () => {
    // June 14, 2027 is EDT (UTC-4)
    const utcMs = zonedDateTimeToUtcMs('2027-06-14', '09:00', 'America/New_York');
    expect(new Date(utcMs).toISOString()).toBe('2027-06-14T13:00:00.000Z');
    const parts = utcMsToZonedParts(utcMs, 'America/New_York');
    expect(parts.ymd).toBe('2027-06-14');
    expect(parts.hhmm).toBe('09:00');
    expect(parts.weekday).toBe(1); // Monday
  });

  it('respects split working hours, date overrides, and buffers', () => {
    const nowMs = Date.parse('2027-06-10T12:00:00.000Z');
    const slots = computeAvailableSlotsByDate({
      eventType: baseEvent,
      schedule: baseSchedule,
      bookings: [],
      startDateYmd: '2027-06-14',
      endDateYmd: '2027-06-16',
      viewerTimeZone: 'America/New_York',
      nowMs,
    });

    // Monday 2027-06-14: 09:00-12:00 (6 slots) + 13:00-17:00 (8 slots) = 14 slots
    expect(slots['2027-06-14']).toHaveLength(14);
    // Tuesday 2027-06-15: overridden unavailable
    expect(slots['2027-06-15']).toBeUndefined();
    // Wednesday 2027-06-16: overridden 10:00-11:00 = 2 slots
    expect(slots['2027-06-16']).toHaveLength(2);
  });

  it('rejects double bookings and enforces buffer windows', () => {
    const nowMs = Date.parse('2027-06-10T12:00:00.000Z');
    const bookedStart = '2027-06-14T14:00:00.000Z'; // 10:00 AM EDT
    const bookedEnd = '2027-06-14T14:30:00.000Z'; // 10:30 AM EDT

    const existing: Booking[] = [
      {
        id: 'b_1',
        uid: 'bk_1',
        eventTypeId: 'evt_1',
        eventTypeTitle: '30 Min Meeting',
        eventTypeSlug: '30min',
        title: 'Test',
        startUtc: bookedStart,
        endUtc: bookedEnd,
        durationMinutes: 30,
        status: 'confirmed',
        attendeeName: 'Sam',
        attendeeEmail: 'sam@example.com',
        attendeeTimezone: 'UTC',
        attendeeNotes: '',
        customAnswers: {},
        locationType: 'jitsi',
        locationDisplay: 'Jitsi',
        meetingUrl: '',
        cancelToken: 'c',
        rescheduleToken: 'r',
        createdAt: '2027-06-10T00:00:00.000Z',
        updatedAt: '2027-06-10T00:00:00.000Z',
      },
    ];

    // Exact same slot -> 409 conflict
    const exactConflict = isSlotBookable({
      startUtc: bookedStart,
      eventType: baseEvent,
      schedule: baseSchedule,
      bookings: existing,
      nowMs,
    });
    expect(exactConflict.ok).toBe(false);
    if (!exactConflict.ok) expect(exactConflict.code).toBe(409);

    // 09:30-10:00 with 15m bufferAfter ends at 10:15 -> overlaps 10:00 booking -> conflict!
    const bufferConflict = isSlotBookable({
      startUtc: '2027-06-14T13:30:00.000Z',
      eventType: baseEvent,
      schedule: baseSchedule,
      bookings: existing,
      nowMs,
    });
    expect(bufferConflict.ok).toBe(false);

    // Rescheduling the SAME booking into its own slot works when excludeBookingId is passed
    const rescheduleSelf = isSlotBookable({
      startUtc: bookedStart,
      eventType: baseEvent,
      schedule: baseSchedule,
      bookings: existing,
      nowMs,
      excludeBookingId: 'b_1',
    });
    expect(rescheduleSelf.ok).toBe(true);
  });

  it('generates and parses RFC 5545 ICS calendar invites and busy feeds', () => {
    const booking: Booking = {
      id: 'b_ics',
      uid: 'bk_ics99',
      eventTypeId: 'evt_1',
      eventTypeTitle: '30 Min Meeting',
      eventTypeSlug: '30min',
      title: '30 Min Meeting between Alex and Pat',
      startUtc: '2027-06-14T14:00:00.000Z',
      endUtc: '2027-06-14T14:30:00.000Z',
      durationMinutes: 30,
      status: 'confirmed',
      attendeeName: 'Pat',
      attendeeEmail: 'pat@example.com',
      attendeeTimezone: 'UTC',
      attendeeNotes: 'Discuss Workers',
      customAnswers: {},
      locationType: 'jitsi',
      locationDisplay: 'Jitsi',
      meetingUrl: 'https://meet.jit.si/edgecal-bk_ics99',
      cancelToken: 'c',
      rescheduleToken: 'r',
      createdAt: '2027-06-10T00:00:00.000Z',
      updatedAt: '2027-06-10T00:00:00.000Z',
    };

    const ics = generateBookingIcs(
      booking,
      { name: 'Alex', email: 'alex@example.com', username: 'alex' },
      'https://cal.example.com',
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20270614T140000Z');
    expect(ics).toContain('DTEND:20270614T143000Z');
    expect(ics).toContain('UID:bk_ics99@edgecal.workers');

    const feed = generateHostFeedIcs(
      [booking],
      { name: 'Alex', email: 'alex@example.com', username: 'alex' },
      'https://cal.example.com',
    );
    const parsed = parseIcsBusyIntervals(
      feed,
      'ics_feed',
      Date.parse('2027-06-14T00:00:00Z'),
      Date.parse('2027-06-15T00:00:00Z'),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].startUtc).toBe('2027-06-14T14:00:00.000Z');
    expect(parsed[0].endUtc).toBe('2027-06-14T14:30:00.000Z');
  });

  it('expands recurring RRULE events and respects EXDATE in external ICS feeds', () => {
    const recurringIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:standup-1@example.com',
      'SUMMARY:Daily Standup',
      'DTSTART:20270614T150000Z',
      'DTEND:20270614T153000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4',
      'EXDATE:20270616T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const parsed = parseIcsBusyIntervals(
      recurringIcs,
      'ics_feed',
      Date.parse('2027-06-14T00:00:00Z'),
      Date.parse('2027-06-30T00:00:00Z'),
    );
    // Mon Jun 14, (Wed Jun 16 excluded by EXDATE), Fri Jun 18, Mon Jun 21 => 3 occurrences
    expect(parsed.map((i) => i.startUtc)).toEqual([
      '2027-06-14T15:00:00.000Z',
      '2027-06-18T15:00:00.000Z',
      '2027-06-21T15:00:00.000Z',
    ]);
  });

  it('hashes passwords and signs webhooks with native Web Crypto', async () => {
    const { hash, salt } = await hashPassword('super-secret-pass');
    expect(await verifyPassword('super-secret-pass', hash, salt)).toBe(true);
    expect(await verifyPassword('wrong-pass', hash, salt)).toBe(false);

    const sig1 = await signHmacSha256('whsec_123', '{"event":"BOOKING_CREATED"}');
    const sig2 = await signHmacSha256('whsec_123', '{"event":"BOOKING_CREATED"}');
    expect(sig1).toHaveLength(64);
    expect(sig1).toBe(sig2);
  });
});
