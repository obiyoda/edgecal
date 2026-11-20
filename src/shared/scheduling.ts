import type {
  AvailabilitySchedule,
  BlockedInterval,
  Booking,
  EventType,
  TimeFormat,
  TimeRange,
  TimeSlot,
} from './types';

export interface ZonedDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  weekday: number; // 0 (Sun) .. 6 (Sat)
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
  ymd: string; // YYYY-MM-DD
  hhmm: string; // HH:MM
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dtfCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, fmt);
  }
  return fmt;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function safeTimeZone(tz?: string | null): string {
  if (!tz) return 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function utcMsToZonedParts(utcMs: number, timeZone: string): ZonedDateParts {
  const tz = safeTimeZone(timeZone);
  const parts = getPartsFormatter(tz).formatToParts(new Date(utcMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'weekday') weekday = WEEKDAY_MAP[p.value] ?? 0;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'second') second = Number(p.value);
  }

  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    ymd: `${year}-${pad2(month)}-${pad2(day)}`,
    hhmm: `${pad2(hour)}:${pad2(minute)}`,
  };
}

/**
 * Converts a wall-clock date ("YYYY-MM-DD") + time ("HH:MM") in `timeZone`
 * into an exact UTC timestamp in milliseconds using 2-step offset convergence
 * so DST boundaries resolve cleanly.
 */
export function zonedDateTimeToUtcMs(
  ymd: string,
  hhmm: string,
  timeZone: string,
): number {
  const tz = safeTimeZone(timeZone);
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const targetAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  let guess = targetAsUtc;
  for (let i = 0; i < 3; i++) {
    const p = utcMsToZonedParts(guess, tz);
    const renderedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diff = targetAsUtc - renderedAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function parseHHMMToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

export function getEffectiveRangesForHostDate(
  schedule: AvailabilitySchedule,
  hostYmd: string,
): TimeRange[] {
  const override = schedule.dateOverrides.find((o) => o.dateYmd === hostYmd);
  if (override) {
    return override.unavailable ? [] : override.ranges;
  }
  const middayMs = zonedDateTimeToUtcMs(hostYmd, '12:00', schedule.timezone);
  const weekday = utcMsToZonedParts(middayMs, schedule.timezone).weekday;
  return schedule.weeklyHours[weekday] ?? [];
}

export interface ConflictCheckParams {
  startMs: number;
  endMs: number;
  eventType: EventType;
  bookings: Booking[];
  blockedIntervals?: BlockedInterval[];
  excludeBookingId?: string;
}

/**
 * Checks whether a candidate slot [startMs, endMs) conflicts with any active booking
 * (accounting for buffers) or external calendar busy interval.
 */
export function hasBookingConflict({
  startMs,
  endMs,
  eventType,
  bookings,
  blockedIntervals = [],
  excludeBookingId,
}: ConflictCheckParams): boolean {
  const reqStartWithBuffer = startMs - eventType.bufferBeforeMinutes * 60_000;
  const reqEndWithBuffer = endMs + eventType.bufferAfterMinutes * 60_000;

  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    if (excludeBookingId && b.id === excludeBookingId) continue;
    const bStart = Date.parse(b.startUtc);
    const bEnd = Date.parse(b.endUtc);
    if (Number.isNaN(bStart) || Number.isNaN(bEnd)) continue;
    if (reqStartWithBuffer < bEnd && reqEndWithBuffer > bStart) {
      return true;
    }
  }

  for (const blk of blockedIntervals) {
    const bStart = Date.parse(blk.startUtc);
    const bEnd = Date.parse(blk.endUtc);
    if (Number.isNaN(bStart) || Number.isNaN(bEnd)) continue;
    if (startMs < bEnd && endMs > bStart) {
      return true;
    }
  }

  return false;
}

export interface ComputeSlotsParams {
  eventType: EventType;
  schedule: AvailabilitySchedule;
  bookings: Booking[];
  blockedIntervals?: BlockedInterval[];
  startDateYmd: string; // in viewerTimeZone
  endDateYmd: string;   // inclusive, in viewerTimeZone
  viewerTimeZone: string;
  nowMs?: number;
  excludeBookingId?: string;
}

/**
 * Computes all available slots grouped by YYYY-MM-DD in `viewerTimeZone`.
 * Iterates across a +/- 1 day padded range in the host's schedule timezone so
 * timezone differences across the international date line never miss slots.
 */
export function computeAvailableSlotsByDate({
  eventType,
  schedule,
  bookings,
  blockedIntervals = [],
  startDateYmd,
  endDateYmd,
  viewerTimeZone,
  nowMs = Date.now(),
  excludeBookingId,
}: ComputeSlotsParams): Record<string, TimeSlot[]> {
  const viewerTz = safeTimeZone(viewerTimeZone);
  const hostTz = safeTimeZone(schedule.timezone);

  const earliestAllowedMs = nowMs + eventType.minimumNoticeMinutes * 60_000;
  const latestAllowedMs = nowMs + eventType.maxFutureDays * 86_400_000;

  const durationMs = Math.max(5, eventType.durationMinutes) * 60_000;
  const stepMs = Math.max(5, eventType.slotIntervalMinutes || eventType.durationMinutes) * 60_000;

  // Pad host dates by 1 day on each side to safely cover any viewer timezone offset (-12..+14)
  const hostStartYmd = addDaysToYmd(startDateYmd, -1);
  const hostEndYmd = addDaysToYmd(endDateYmd, 1);

  const grouped: Record<string, TimeSlot[]> = {};
  const seenStarts = new Set<number>();

  let curYmd = hostStartYmd;
  let guard = 0;
  while (curYmd <= hostEndYmd && guard < 120) {
    guard++;
    const ranges = getEffectiveRangesForHostDate(schedule, curYmd);
    for (const range of ranges) {
      if (!range.start || !range.end || range.start >= range.end) continue;
      const windowStartMs = zonedDateTimeToUtcMs(curYmd, range.start, hostTz);
      const windowEndMs = zonedDateTimeToUtcMs(curYmd, range.end, hostTz);

      for (let slotStart = windowStartMs; slotStart + durationMs <= windowEndMs; slotStart += stepMs) {
        const slotEnd = slotStart + durationMs;
        if (slotStart < earliestAllowedMs) continue;
        if (slotStart > latestAllowedMs) continue;
        if (seenStarts.has(slotStart)) continue;

        const viewerYmd = utcMsToZonedParts(slotStart, viewerTz).ymd;
        if (viewerYmd < startDateYmd || viewerYmd > endDateYmd) continue;

        if (
          hasBookingConflict({
            startMs: slotStart,
            endMs: slotEnd,
            eventType,
            bookings,
            blockedIntervals,
            excludeBookingId,
          })
        ) {
          continue;
        }

        seenStarts.add(slotStart);
        if (!grouped[viewerYmd]) grouped[viewerYmd] = [];
        grouped[viewerYmd].push({
          startUtc: new Date(slotStart).toISOString(),
          endUtc: new Date(slotEnd).toISOString(),
        });
      }
    }
    curYmd = addDaysToYmd(curYmd, 1);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  }

  return grouped;
}

/**
 * Validates whether a specific requested startUtc is genuinely bookable according to
 * the host's schedule, notice period, booking window, and active bookings.
 */
export function isSlotBookable(params: {
  startUtc: string;
  eventType: EventType;
  schedule: AvailabilitySchedule;
  bookings: Booking[];
  blockedIntervals?: BlockedInterval[];
  nowMs?: number;
  excludeBookingId?: string;
}): { ok: true; endUtc: string } | { ok: false; reason: string; code: number } {
  const startMs = Date.parse(params.startUtc);
  if (Number.isNaN(startMs)) {
    return { ok: false, reason: 'Invalid start time format.', code: 400 };
  }

  const nowMs = params.nowMs ?? Date.now();
  const durationMs = Math.max(5, params.eventType.durationMinutes) * 60_000;
  const endMs = startMs + durationMs;

  if (startMs < nowMs + params.eventType.minimumNoticeMinutes * 60_000) {
    return {
      ok: false,
      reason: `This event requires at least ${params.eventType.minimumNoticeMinutes} minutes advance notice.`,
      code: 400,
    };
  }

  if (startMs > nowMs + params.eventType.maxFutureDays * 86_400_000) {
    return {
      ok: false,
      reason: `Bookings can only be made up to ${params.eventType.maxFutureDays} days in advance.`,
      code: 400,
    };
  }

  const hostTz = safeTimeZone(params.schedule.timezone);
  const hostParts = utcMsToZonedParts(startMs, hostTz);
  const ranges = getEffectiveRangesForHostDate(params.schedule, hostParts.ymd);

  const fitsAvailability = ranges.some((r) => {
    if (!r.start || !r.end || r.start >= r.end) return false;
    const wStart = zonedDateTimeToUtcMs(hostParts.ymd, r.start, hostTz);
    const wEnd = zonedDateTimeToUtcMs(hostParts.ymd, r.end, hostTz);
    return startMs >= wStart && endMs <= wEnd;
  });

  if (!fitsAvailability) {
    return {
      ok: false,
      reason: 'Selected time is outside the host’s available hours.',
      code: 409,
    };
  }

  if (
    hasBookingConflict({
      startMs,
      endMs,
      eventType: params.eventType,
      bookings: params.bookings,
      blockedIntervals: params.blockedIntervals,
      excludeBookingId: params.excludeBookingId,
    })
  ) {
    return {
      ok: false,
      reason: 'That time slot was just booked or conflicts with another commitment.',
      code: 409,
    };
  }

  return { ok: true, endUtc: new Date(endMs).toISOString() };
}

export function formatSlotTime(
  utcIso: string,
  timeZone: string,
  timeFormat: TimeFormat = '12h',
): string {
  const tz = safeTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: timeFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  }).format(new Date(utcIso));
}

export function formatDateLong(utcIso: string, timeZone: string): string {
  const tz = safeTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(utcIso));
}

export function formatDateShort(utcIso: string, timeZone: string): string {
  const tz = safeTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(utcIso));
}

export function formatMonthYear(year: number, monthIndex0: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, monthIndex0, 1)));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function getMonthDateBounds(year: number, monthIndex0: number): {
  startYmd: string;
  endYmd: string;
  daysInMonth: number;
  firstWeekday: number;
} {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  return {
    startYmd: `${year}-${pad2(monthIndex0 + 1)}-01`,
    endYmd: `${year}-${pad2(monthIndex0 + 1)}-${pad2(last.getUTCDate())}`,
    daysInMonth: last.getUTCDate(),
    firstWeekday: first.getUTCDay(),
  };
}
