import type { BlockedInterval, Booking, HostProfile } from './types';
import { zonedDateTimeToUtcMs } from './scheduling';

function formatIcsUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  parts.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

export function generateBookingIcs(
  booking: Booking,
  host: Pick<HostProfile, 'name' | 'email' | 'username'>,
  appOrigin: string,
): string {
  const manageUrl = `${appOrigin.replace(/\/$/, '')}/booking/${booking.uid}`;
  const descLines = [
    `Booked with ${host.name}`,
    booking.meetingUrl ? `Join link: ${booking.meetingUrl}` : `Location: ${booking.locationDisplay}`,
    booking.attendeeNotes ? `Notes: ${booking.attendeeNotes}` : '',
    `Manage booking: ${manageUrl}`,
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EdgeCal//Cloudflare Workers Scheduler//EN',
    'CALSCALE:GREGORIAN',
    booking.status === 'cancelled' ? 'METHOD:CANCEL' : 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${booking.uid}@edgecal.workers`,
    `DTSTAMP:${formatIcsUtc(booking.updatedAt || booking.createdAt)}`,
    `DTSTART:${formatIcsUtc(booking.startUtc)}`,
    `DTEND:${formatIcsUtc(booking.endUtc)}`,
    `SUMMARY:${escapeIcsText(booking.title)}`,
    `DESCRIPTION:${escapeIcsText(descLines.join('\n'))}`,
    `LOCATION:${escapeIcsText(booking.meetingUrl || booking.locationDisplay)}`,
    `ORGANIZER;CN=${escapeIcsText(host.name)}:mailto:${host.email}`,
    `ATTENDEE;CN=${escapeIcsText(booking.attendeeName)};RSVP=TRUE:mailto:${booking.attendeeEmail}`,
    `STATUS:${booking.status === 'cancelled' ? 'CANCELLED' : booking.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function generateHostFeedIcs(
  bookings: Booking[],
  host: Pick<HostProfile, 'name' | 'email' | 'username'>,
  appOrigin: string,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EdgeCal//Cloudflare Workers Scheduler//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(`${host.name} — EdgeCal Bookings`)}`,
  ];

  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    const manageUrl = `${appOrigin.replace(/\/$/, '')}/booking/${b.uid}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.uid}@edgecal.workers`,
      `DTSTAMP:${formatIcsUtc(b.updatedAt || b.createdAt)}`,
      `DTSTART:${formatIcsUtc(b.startUtc)}`,
      `DTEND:${formatIcsUtc(b.endUtc)}`,
      `SUMMARY:${escapeIcsText(`${b.eventTypeTitle} with ${b.attendeeName}`)}`,
      `DESCRIPTION:${escapeIcsText(`Attendee: ${b.attendeeName} (${b.attendeeEmail})\nManage: ${manageUrl}`)}`,
      `LOCATION:${escapeIcsText(b.meetingUrl || b.locationDisplay)}`,
      `STATUS:${b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function parseIcsDateValue(rawKey: string, rawVal: string): number | null {
  const val = rawVal.trim();
  const tzMatch = rawKey.match(/TZID=([^;:]+)/i);
  const tzid = tzMatch ? tzMatch[1] : null;

  // All-day date YYYYMMDD
  if (/^\d{8}$/.test(val)) {
    const ymd = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`;
    return tzid ? zonedDateTimeToUtcMs(ymd, '00:00', tzid) : Date.parse(`${ymd}T00:00:00Z`);
  }

  // Date-time YYYYMMDDTHHMMSS(Z)?
  const dtMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!dtMatch) return null;
  const [, y, m, d, hh, mm, ss, z] = dtMatch;
  if (z === 'Z' || !tzid) {
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  return zonedDateTimeToUtcMs(`${y}-${m}-${d}`, `${hh}:${mm}`, tzid);
}

const ICS_DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

interface ParsedRRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  untilMs?: number;
  byDay?: number[];
}

function parseRRule(raw: string): ParsedRRule | null {
  const parts = raw.trim().toUpperCase().split(';');
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq !== -1) {
      map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  const freq = map.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  const intervalRaw = Number(map.get('INTERVAL') || '1');
  const interval = Number.isFinite(intervalRaw) && intervalRaw >= 1 ? Math.floor(intervalRaw) : 1;

  const countRaw = map.has('COUNT') ? Number(map.get('COUNT')) : undefined;
  const count = countRaw !== undefined && Number.isFinite(countRaw) && countRaw >= 1
    ? Math.floor(countRaw)
    : undefined;

  let untilMs: number | undefined;
  const untilRaw = map.get('UNTIL');
  if (untilRaw) {
    const parsedUntil = parseIcsDateValue('UNTIL', untilRaw);
    if (parsedUntil !== null) {
      // For date-only UNTIL values (YYYYMMDD), treat as inclusive through end of day UTC
      untilMs = /^\d{8}$/.test(untilRaw) ? parsedUntil + 86_400_000 - 1 : parsedUntil;
    }
  }

  let byDay: number[] | undefined;
  const byDayRaw = map.get('BYDAY');
  if (byDayRaw) {
    const days = byDayRaw
      .split(',')
      .map((d) => ICS_DAY_MAP[d.replace(/^[-+]?\d+/, '')])
      .filter((d): d is number => d !== undefined);
    if (days.length > 0) {
      byDay = Array.from(new Set(days)).sort((a, b) => a - b);
    }
  }

  return { freq, interval, count, untilMs, byDay };
}

function expandRecurringStarts(
  startMs: number,
  rrule: ParsedRRule,
  windowEndMs: number,
  exdates: Set<number>,
): number[] {
  const MAX_OCCURRENCES = 500;
  const limitEndMs = rrule.untilMs !== undefined ? Math.min(rrule.untilMs, windowEndMs) : windowEndMs;
  if (startMs > limitEndMs) return [];

  const starts: number[] = [];
  let generated = 0;

  const pushIfAllowed = (ms: number): boolean => {
    if (ms < startMs) return true;
    if (ms > limitEndMs) return false;
    generated++;
    if (rrule.count !== undefined && generated > rrule.count) return false;
    if (starts.length >= MAX_OCCURRENCES) return false;
    if (!exdates.has(ms)) {
      starts.push(ms);
    }
    return true;
  };

  const base = new Date(startMs);
  const baseH = base.getUTCHours();
  const baseMin = base.getUTCMinutes();
  const baseS = base.getUTCSeconds();

  if (rrule.freq === 'DAILY') {
    for (let step = 0; step < 2000; step++) {
      const ms = startMs + step * rrule.interval * 86_400_000;
      if (!pushIfAllowed(ms)) break;
    }
  } else if (rrule.freq === 'WEEKLY') {
    const targetDays = rrule.byDay && rrule.byDay.length > 0 ? rrule.byDay : [base.getUTCDay()];
    // Anchor to Sunday 00:00 UTC of the start event's week
    const startOfWeekUtc = Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() - base.getUTCDay(),
      baseH,
      baseMin,
      baseS,
    );
    let stop = false;
    for (let week = 0; week < 400 && !stop; week++) {
      const weekBaseMs = startOfWeekUtc + week * rrule.interval * 7 * 86_400_000;
      for (const dow of targetDays) {
        const ms = weekBaseMs + dow * 86_400_000;
        if (ms < startMs) continue;
        if (!pushIfAllowed(ms)) {
          stop = true;
          break;
        }
      }
    }
  } else if (rrule.freq === 'MONTHLY') {
    const startYear = base.getUTCFullYear();
    const startMonth = base.getUTCMonth();
    const startDay = base.getUTCDate();
    for (let step = 0; step < 240; step++) {
      const totalMonths = startMonth + step * rrule.interval;
      const year = startYear + Math.floor(totalMonths / 12);
      const month = totalMonths % 12;
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      if (startDay > daysInMonth) continue;
      const ms = Date.UTC(year, month, startDay, baseH, baseMin, baseS);
      if (!pushIfAllowed(ms)) break;
    }
  } else if (rrule.freq === 'YEARLY') {
    const startYear = base.getUTCFullYear();
    const startMonth = base.getUTCMonth();
    const startDay = base.getUTCDate();
    for (let step = 0; step < 50; step++) {
      const year = startYear + step * rrule.interval;
      const daysInMonth = new Date(Date.UTC(year, startMonth + 1, 0)).getUTCDate();
      if (startDay > daysInMonth) continue;
      const ms = Date.UTC(year, startMonth, startDay, baseH, baseMin, baseS);
      if (!pushIfAllowed(ms)) break;
    }
  }

  return starts;
}

/**
 * Parses an external ICS calendar feed into busy BlockedInterval items within
 * [windowStartMs, windowEndMs] so Google/Apple/Outlook busy times block booking slots.
 * Supports single VEVENTs as well as recurring RRULE (DAILY, WEEKLY, MONTHLY, YEARLY) and EXDATE.
 */
export function parseIcsBusyIntervals(
  icsText: string,
  source: string,
  windowStartMs: number,
  windowEndMs: number,
): BlockedInterval[] {
  // Unfold RFC 5545 folded lines
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const results: BlockedInterval[] = [];
  let inEvent = false;
  let uid = '';
  let summary = 'Busy';
  let startMs: number | null = null;
  let endMs: number | null = null;
  let rruleRaw = '';
  let exdates = new Set<number>();
  let transparent = false;
  let cancelled = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      uid = '';
      summary = 'Busy';
      startMs = null;
      endMs = null;
      rruleRaw = '';
      exdates = new Set<number>();
      transparent = false;
      cancelled = false;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent && !transparent && !cancelled && startMs !== null) {
        const durationMs = endMs !== null && endMs > startMs ? endMs - startMs : 60 * 60_000;
        const parsedRule = rruleRaw ? parseRRule(rruleRaw) : null;
        const occurrenceStarts = parsedRule
          ? expandRecurringStarts(startMs, parsedRule, windowEndMs, exdates)
          : exdates.has(startMs)
            ? []
            : [startMs];

        for (const occStart of occurrenceStarts) {
          const occEnd = occStart + durationMs;
          if (occEnd > windowStartMs && occStart < windowEndMs && occEnd > occStart) {
            results.push({
              id: parsedRule
                ? `${uid || source}-${occStart}`
                : uid || `${source}-${occStart}`,
              source,
              title: summary,
              startUtc: new Date(occStart).toISOString(),
              endUtc: new Date(occEnd).toISOString(),
            });
          }
        }
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const upperKey = key.toUpperCase();

    if (upperKey === 'UID') uid = val.trim();
    else if (upperKey === 'SUMMARY') summary = val.trim() || 'Busy';
    else if (upperKey === 'TRANSP' && val.trim().toUpperCase() === 'TRANSPARENT') transparent = true;
    else if (upperKey === 'STATUS' && val.trim().toUpperCase() === 'CANCELLED') cancelled = true;
    else if (upperKey === 'RRULE') rruleRaw = val.trim();
    else if (upperKey === 'EXDATE' || upperKey.startsWith('EXDATE;')) {
      for (const token of val.split(',')) {
        const ex = parseIcsDateValue(key, token);
        if (ex !== null) exdates.add(ex);
      }
    } else if (upperKey === 'DTSTART' || upperKey.startsWith('DTSTART;')) {
      startMs = parseIcsDateValue(key, val);
    } else if (upperKey === 'DTEND' || upperKey.startsWith('DTEND;')) {
      endMs = parseIcsDateValue(key, val);
    }
  }

  return results;
}

export function buildGoogleCalendarUrl(
  booking: Pick<Booking, 'title' | 'startUtc' | 'endUtc' | 'meetingUrl' | 'locationDisplay' | 'attendeeNotes'>,
  hostName: string,
): string {
  const start = formatIcsUtc(booking.startUtc);
  const end = formatIcsUtc(booking.endUtc);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: booking.title,
    dates: `${start}/${end}`,
    details: `Booked with ${hostName}${booking.meetingUrl ? `\nJoin: ${booking.meetingUrl}` : ''}${booking.attendeeNotes ? `\nNotes: ${booking.attendeeNotes}` : ''}`,
    location: booking.meetingUrl || booking.locationDisplay,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
