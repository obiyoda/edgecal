import {
  DEFAULT_WEEKLY_HOURS,
  LOCATION_LABELS,
  type ActivityLogEntry,
  type AvailabilitySchedule,
  type BlockedInterval,
  type Booking,
  type CustomQuestion,
  type DateOverride,
  type DOStatusInfo,
  type EventType,
  type HostProfile,
  type IntegrationConfig,
  type IntegrationProvider,
  type LocationType,
  type PublicBooking,
  type TimeFormat,
  type TimeRange,
  type WebhookConfig,
  type WebhookEventType,
  type WeeklyHours,
} from '../shared/types';
import {
  computeAvailableSlotsByDate,
  formatDateLong,
  formatSlotTime,
  isSlotBookable,
  safeTimeZone,
  slugify,
} from '../shared/scheduling';
import { generateBookingIcs, generateHostFeedIcs, parseIcsBusyIntervals } from '../shared/ics';
import { randomToken, randomUid, signHmacSha256 } from './crypto';
import type { Env } from './env';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeInt(value: unknown, fallback: number, min: number, max?: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(min, Math.round(n));
  return max !== undefined ? Math.min(max, clamped) : clamped;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toPublicBooking(booking: Booking, includePrivateDetails: boolean): PublicBooking {
  const { cancelToken: _ct, rescheduleToken: _rt, ...pub } = booking;
  if (!includePrivateDetails) {
    return {
      ...pub,
      attendeeEmail: '',
      attendeeNotes: '',
      customAnswers: {},
    };
  }
  return pub;
}

export class HostSchedulerDO {
  private ctx: DurableObjectState;
  private env: Env;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;

    this.ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          host_id TEXT NOT NULL,
          username TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          bio TEXT NOT NULL DEFAULT '',
          timezone TEXT NOT NULL DEFAULT 'UTC',
          time_format TEXT NOT NULL DEFAULT '12h',
          brand_color TEXT NOT NULL DEFAULT '#111827',
          avatar_color TEXT NOT NULL DEFAULT '#ea580c',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          timezone TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          weekly_hours_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS date_overrides (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL,
          date_ymd TEXT NOT NULL,
          unavailable INTEGER NOT NULL DEFAULT 1,
          ranges_json TEXT NOT NULL DEFAULT '[]',
          label TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS event_types (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          duration_minutes INTEGER NOT NULL DEFAULT 30,
          buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
          buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
          minimum_notice_minutes INTEGER NOT NULL DEFAULT 60,
          max_future_days INTEGER NOT NULL DEFAULT 60,
          slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
          location_type TEXT NOT NULL DEFAULT 'jitsi',
          location_value TEXT NOT NULL DEFAULT '',
          requires_confirmation INTEGER NOT NULL DEFAULT 0,
          color TEXT NOT NULL DEFAULT '#111827',
          hidden INTEGER NOT NULL DEFAULT 0,
          schedule_id TEXT NOT NULL,
          custom_questions_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          uid TEXT NOT NULL UNIQUE,
          event_type_id TEXT NOT NULL,
          event_type_title TEXT NOT NULL,
          event_type_slug TEXT NOT NULL,
          title TEXT NOT NULL,
          start_utc TEXT NOT NULL,
          end_utc TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'confirmed',
          attendee_name TEXT NOT NULL,
          attendee_email TEXT NOT NULL,
          attendee_timezone TEXT NOT NULL DEFAULT 'UTC',
          attendee_notes TEXT NOT NULL DEFAULT '',
          custom_answers_json TEXT NOT NULL DEFAULT '{}',
          location_type TEXT NOT NULL DEFAULT 'jitsi',
          location_display TEXT NOT NULL DEFAULT '',
          meeting_url TEXT NOT NULL DEFAULT '',
          cancel_token TEXT NOT NULL,
          reschedule_token TEXT NOT NULL,
          cancellation_reason TEXT DEFAULT '',
          reminder_24h_sent_at TEXT,
          reminder_1h_sent_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          secret TEXT NOT NULL,
          events_json TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          last_status INTEGER,
          last_triggered_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS integrations (
          provider TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          config_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS blocked_slots (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          title TEXT NOT NULL,
          start_utc TEXT NOT NULL,
          end_utc TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_utc);
        CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
        CREATE INDEX IF NOT EXISTS idx_overrides_schedule ON date_overrides(schedule_id);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const rawOrigin = url.searchParams.get('origin');
    if (rawOrigin && /^https?:\/\//i.test(rawOrigin) && !rawOrigin.startsWith('https://do.internal')) {
      this.setMeta('app_origin', rawOrigin.replace(/\/$/, ''));
    }
    const origin =
      rawOrigin || this.env.APP_URL || this.getMeta('app_origin') || url.origin;

    try {
      // 1. Initialize host workspace
      if (path === '/init' && request.method === 'POST') {
        const body = (await request.json()) as {
          hostId: string;
          username: string;
          name: string;
          email: string;
          timezone?: string;
          weeklyHours?: WeeklyHours;
          createStarterEvents?: boolean;
        };
        return this.initHost(body);
      }

      // 2. Public endpoints
      if (path === '/public' && request.method === 'GET') {
        const profile = this.getProfile();
        if (!profile) return json({ error: 'Host not initialized.' }, 404);
        const eventTypes = this.listEventTypes().filter((et) => !et.hidden);
        const { email: _hiddenEmail, ...publicProfile } = profile;
        return json({ profile: publicProfile, eventTypes });
      }

      if (path === '/public/slots' && request.method === 'GET') {
        const slug = url.searchParams.get('slug') || '';
        const startDate = url.searchParams.get('startDate') || '';
        const endDate = url.searchParams.get('endDate') || '';
        const timeZone = safeTimeZone(url.searchParams.get('timeZone') || 'UTC');
        const excludeBookingId = url.searchParams.get('excludeBookingId') || undefined;

        const eventType = this.getEventTypeBySlug(slug);
        if (!eventType || eventType.hidden) {
          return json({ error: 'Event type not found.' }, 404);
        }
        const schedule = this.getScheduleById(eventType.scheduleId) ?? this.getDefaultSchedule();
        if (!schedule) return json({ error: 'No availability schedule configured.' }, 400);

        const bookings = this.listBookings();
        const blockedIntervals = this.listBlockedIntervals();
        const slots = computeAvailableSlotsByDate({
          eventType,
          schedule,
          bookings,
          blockedIntervals,
          startDateYmd: startDate,
          endDateYmd: endDate,
          viewerTimeZone: timeZone,
          excludeBookingId,
        });
        return json({ slots, eventType, scheduleTimezone: schedule.timezone });
      }

      if (path === '/public/bookings' && request.method === 'POST') {
        const body = (await request.json()) as {
          eventTypeSlug: string;
          startUtc: string;
          attendeeName: string;
          attendeeEmail: string;
          attendeeTimezone: string;
          attendeeNotes?: string;
          customAnswers?: Record<string, string>;
        };
        return this.createBooking(body, origin);
      }

      if (path === '/public/feed.ics' && request.method === 'GET') {
        const profile = this.getProfile();
        if (!profile) return new Response('Not found', { status: 404 });
        const bookings = this.listBookings();
        const ics = generateHostFeedIcs(bookings, profile, origin);
        return new Response(ics, {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `inline; filename="${profile.username}-edgecal.ics"`,
          },
        });
      }

      if (path.startsWith('/booking/uid/') && request.method === 'GET') {
        const uid = decodeURIComponent(path.slice('/booking/uid/'.length));
        const booking = this.getBookingByUid(uid);
        const profile = this.getProfile();
        if (!booking || !profile) return json({ error: 'Booking not found.' }, 404);
        const asHost = url.searchParams.get('asHost') === '1';
        const cancelToken = url.searchParams.get('cancelToken') || '';
        const rescheduleToken = url.searchParams.get('rescheduleToken') || '';
        const canCancel = asHost || (Boolean(cancelToken) && cancelToken === booking.cancelToken);
        const canReschedule =
          asHost || (Boolean(rescheduleToken) && rescheduleToken === booking.rescheduleToken);
        const { email: _e, ...publicProfile } = profile;
        return json({
          booking: toPublicBooking(booking, canCancel || canReschedule),
          host: publicProfile,
          canCancel,
          canReschedule,
        });
      }

      if (path.startsWith('/booking/ics/') && request.method === 'GET') {
        const uid = decodeURIComponent(path.slice('/booking/ics/'.length));
        const booking = this.getBookingByUid(uid);
        const profile = this.getProfile();
        if (!booking || !profile) return new Response('Not found', { status: 404 });
        const ics = generateBookingIcs(booking, profile, origin);
        return new Response(ics, {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="booking-${booking.uid}.ics"`,
          },
        });
      }

      if (path.startsWith('/booking/uid/') && path.endsWith('/cancel') && request.method === 'POST') {
        const uid = decodeURIComponent(
          path.slice('/booking/uid/'.length, -'/cancel'.length),
        );
        const body = (await request.json()) as { token?: string; reason?: string; asHost?: boolean };
        return this.cancelBooking(uid, body, origin);
      }

      if (path.startsWith('/booking/uid/') && path.endsWith('/reschedule') && request.method === 'POST') {
        const uid = decodeURIComponent(
          path.slice('/booking/uid/'.length, -'/reschedule'.length),
        );
        const body = (await request.json()) as {
          token?: string;
          newStartUtc: string;
          attendeeTimezone?: string;
          asHost?: boolean;
        };
        return this.rescheduleBooking(uid, body, origin);
      }

      // 3. Authenticated Dashboard Endpoints
      if (path === '/profile' && request.method === 'GET') {
        const profile = this.getProfile();
        if (!profile) return json({ error: 'Profile not found.' }, 404);
        return json({ profile });
      }

      if (path === '/profile' && request.method === 'PUT') {
        const body = (await request.json()) as Partial<HostProfile>;
        const current = this.getProfile();
        if (!current) return json({ error: 'Profile not found.' }, 404);

        const next: HostProfile = {
          ...current,
          username: body.username ?? current.username,
          name: body.name !== undefined ? body.name.trim() || current.name : current.name,
          email: body.email ?? current.email,
          bio: body.bio !== undefined ? body.bio : current.bio,
          timezone: body.timezone ? safeTimeZone(body.timezone) : current.timezone,
          timeFormat: body.timeFormat === '24h' ? '24h' : body.timeFormat === '12h' ? '12h' : current.timeFormat,
          brandColor: body.brandColor ?? current.brandColor,
          avatarColor: body.avatarColor ?? current.avatarColor,
        };

        this.sql.exec(
          `UPDATE profile SET username = ?, name = ?, email = ?, bio = ?, timezone = ?,
           time_format = ?, brand_color = ?, avatar_color = ? WHERE id = 1`,
          next.username,
          next.name,
          next.email,
          next.bio,
          next.timezone,
          next.timeFormat,
          next.brandColor,
          next.avatarColor,
        );
        return json({ profile: next });
      }

      if (path === '/event-types' && request.method === 'GET') {
        return json({ eventTypes: this.listEventTypes() });
      }

      if (path === '/event-types' && request.method === 'POST') {
        const body = (await request.json()) as Partial<EventType>;
        return this.createEventType(body);
      }

      if (path.startsWith('/event-types/') && request.method === 'PUT') {
        const id = decodeURIComponent(path.slice('/event-types/'.length));
        const body = (await request.json()) as Partial<EventType>;
        return this.updateEventType(id, body);
      }

      if (path.startsWith('/event-types/') && request.method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/event-types/'.length));
        this.sql.exec('DELETE FROM event_types WHERE id = ?', id);
        return json({ ok: true });
      }

      if (path === '/schedules' && request.method === 'GET') {
        return json({ schedules: this.listSchedules() });
      }

      if (path === '/schedules' && request.method === 'POST') {
        const body = (await request.json()) as {
          name: string;
          timezone?: string;
          isDefault?: boolean;
          weeklyHours?: WeeklyHours;
        };
        return this.createSchedule(body);
      }

      if (path.startsWith('/schedules/') && path.endsWith('/overrides') && request.method === 'POST') {
        const scheduleId = decodeURIComponent(
          path.slice('/schedules/'.length, -'/overrides'.length),
        );
        const body = (await request.json()) as {
          dateYmd: string;
          unavailable: boolean;
          ranges?: TimeRange[];
          label?: string;
        };
        return this.upsertDateOverride(scheduleId, body);
      }

      if (path.startsWith('/schedules/overrides/') && request.method === 'DELETE') {
        const overrideId = decodeURIComponent(path.slice('/schedules/overrides/'.length));
        this.sql.exec('DELETE FROM date_overrides WHERE id = ?', overrideId);
        return json({ ok: true });
      }

      if (path.startsWith('/schedules/') && request.method === 'PUT') {
        const id = decodeURIComponent(path.slice('/schedules/'.length));
        const body = (await request.json()) as Partial<AvailabilitySchedule>;
        return this.updateSchedule(id, body);
      }

      if (path.startsWith('/schedules/') && request.method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/schedules/'.length));
        const schedules = this.listSchedules();
        if (schedules.length <= 1) {
          return json({ error: 'You must keep at least one availability schedule.' }, 400);
        }
        this.sql.exec('DELETE FROM date_overrides WHERE schedule_id = ?', id);
        this.sql.exec('DELETE FROM schedules WHERE id = ?', id);
        const remaining = this.listSchedules();
        if (remaining.length > 0 && !remaining.some((s) => s.isDefault)) {
          this.sql.exec('UPDATE schedules SET is_default = 1 WHERE id = ?', remaining[0].id);
        }
        return json({ ok: true });
      }

      if (path === '/bookings' && request.method === 'GET') {
        return json({ bookings: this.listBookings() });
      }

      if (path.startsWith('/bookings/') && path.endsWith('/confirm') && request.method === 'POST') {
        const id = decodeURIComponent(path.slice('/bookings/'.length, -'/confirm'.length));
        return this.confirmBooking(id, origin);
      }

      if (path.startsWith('/bookings/') && path.endsWith('/cancel') && request.method === 'POST') {
        const id = decodeURIComponent(path.slice('/bookings/'.length, -'/cancel'.length));
        const body = (await request.json().catch(() => ({}))) as { reason?: string };
        const booking = this.getBookingById(id);
        if (!booking) return json({ error: 'Booking not found.' }, 404);
        return this.cancelBooking(booking.uid, { reason: body.reason, asHost: true }, origin);
      }

      if (path === '/webhooks' && request.method === 'GET') {
        return json({ webhooks: this.listWebhooks() });
      }

      if (path === '/webhooks' && request.method === 'POST') {
        const body = (await request.json()) as {
          url: string;
          events?: WebhookEventType[];
          secret?: string;
        };
        if (!body.url || !body.url.startsWith('http')) {
          return json({ error: 'Webhook URL must start with http:// or https://.' }, 400);
        }
        const id = `wh_${randomToken(8)}`;
        const secret = body.secret?.trim() || `whsec_${randomToken(16)}`;
        const events: WebhookEventType[] = body.events?.length
          ? body.events
          : ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'];
        const createdAt = new Date().toISOString();
        this.sql.exec(
          'INSERT INTO webhooks (id, url, secret, events_json, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
          id,
          body.url.trim(),
          secret,
          JSON.stringify(events),
          createdAt,
        );
        return json({ webhook: { id, url: body.url.trim(), secret, events, active: true, createdAt } }, 201);
      }

      if (path.startsWith('/webhooks/') && path.endsWith('/test') && request.method === 'POST') {
        const id = decodeURIComponent(path.slice('/webhooks/'.length, -'/test'.length));
        const wh = this.listWebhooks().find((w) => w.id === id);
        if (!wh) return json({ error: 'Webhook not found.' }, 404);
        const status = await this.deliverWebhook(wh, 'BOOKING_CREATED', {
          test: true,
          message: 'Test event from EdgeCal Durable Object',
          timestamp: new Date().toISOString(),
        });
        return json({ ok: status >= 200 && status < 300, status });
      }

      if (path.startsWith('/webhooks/') && request.method === 'PUT') {
        const id = decodeURIComponent(path.slice('/webhooks/'.length));
        const body = (await request.json()) as Partial<WebhookConfig>;
        const wh = this.listWebhooks().find((w) => w.id === id);
        if (!wh) return json({ error: 'Webhook not found.' }, 404);
        this.sql.exec(
          'UPDATE webhooks SET url = ?, events_json = ?, active = ? WHERE id = ?',
          body.url ?? wh.url,
          JSON.stringify(body.events ?? wh.events),
          body.active === undefined ? (wh.active ? 1 : 0) : body.active ? 1 : 0,
          id,
        );
        return json({ ok: true });
      }

      if (path.startsWith('/webhooks/') && request.method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/webhooks/'.length));
        this.sql.exec('DELETE FROM webhooks WHERE id = ?', id);
        return json({ ok: true });
      }

      if (path === '/integrations' && request.method === 'GET') {
        return json({
          integrations: this.listIntegrations(),
          blockedSlotsCount: this.listBlockedIntervals().length,
        });
      }

      if (path.startsWith('/integrations/') && path.endsWith('/sync') && request.method === 'POST') {
        const synced = await this.syncExternalIcsFeed();
        await this.scheduleNextAlarm();
        return json(synced);
      }

      if (path.startsWith('/integrations/') && request.method === 'PUT') {
        const provider = decodeURIComponent(
          path.slice('/integrations/'.length),
        ) as IntegrationProvider;
        const body = (await request.json()) as {
          enabled: boolean;
          config: Record<string, string>;
        };
        const updatedAt = new Date().toISOString();
        this.sql.exec(
          `INSERT OR REPLACE INTO integrations (provider, enabled, config_json, updated_at)
           VALUES (?, ?, ?, ?)`,
          provider,
          body.enabled ? 1 : 0,
          JSON.stringify(body.config ?? {}),
          updatedAt,
        );
        this.logActivity('system', `Updated ${provider} integration (${body.enabled ? 'enabled' : 'disabled'}).`);
        if (provider === 'ics_feed' && body.enabled && body.config?.feedUrl) {
          await this.syncExternalIcsFeed();
        }
        await this.scheduleNextAlarm();
        return json({ ok: true, updatedAt });
      }

      if (path === '/status' && request.method === 'GET') {
        const status = await this.getDOStatus();
        return json(status);
      }

      if (path === '/export' && request.method === 'GET') {
        return json({
          exportedAt: new Date().toISOString(),
          profile: this.getProfile(),
          schedules: this.listSchedules(),
          eventTypes: this.listEventTypes(),
          bookings: this.listBookings(),
          webhooks: this.listWebhooks(),
          integrations: this.listIntegrations(),
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal Durable Object error';
      return json({ error: msg }, 500);
    }
  }

  /**
   * Native Cloudflare Durable Object Alarm handler:
   * - Fires 24h and 1h reminders for upcoming confirmed bookings
   * - Auto-expires past unconfirmed bookings
   * - Refreshes external ICS calendar feed busy times
   * - Re-arms itself for the next due timestamp
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const profile = this.getProfile();
    const origin =
      this.env.APP_URL || this.getMeta('app_origin') || 'https://edgecal.workers.dev';

    if (profile) {
      const bookings = this.listBookings();
      for (const b of bookings) {
        const startMs = Date.parse(b.startUtc);
        if (Number.isNaN(startMs)) continue;

        // Expire pending bookings that passed their start time
        if (b.status === 'pending' && startMs <= now) {
          const updatedAt = new Date(now).toISOString();
          this.sql.exec(
            `UPDATE bookings SET status = 'cancelled', cancellation_reason = ?, updated_at = ? WHERE id = ?`,
            'Auto-expired: host did not confirm before start time.',
            updatedAt,
            b.id,
          );
          this.logActivity('alarm', `Auto-expired unconfirmed booking ${b.uid} (${b.attendeeName}).`);
          continue;
        }

        if (b.status !== 'confirmed') continue;

        const msUntil = startMs - now;
        // 24h reminder window (between 24h and 2h before start)
        if (!b.reminder24hSentAt && msUntil <= 24 * 3600_000 && msUntil > 2 * 3600_000) {
          const sentAt = new Date(now).toISOString();
          this.sql.exec('UPDATE bookings SET reminder_24h_sent_at = ? WHERE id = ?', sentAt, b.id);
          this.logActivity('alarm', `Sent 24h reminder for "${b.title}" to ${b.attendeeEmail}.`);
          await this.dispatchBookingNotification('BOOKING_REMINDER', { ...b, reminder24hSentAt: sentAt }, profile, origin, '24 hours');
        }

        // 1h reminder window (between 65 min and 0 min before start)
        if (!b.reminder1hSentAt && msUntil <= 65 * 60_000 && msUntil > 0) {
          const sentAt = new Date(now).toISOString();
          this.sql.exec('UPDATE bookings SET reminder_1h_sent_at = ? WHERE id = ?', sentAt, b.id);
          this.logActivity('alarm', `Sent 1h reminder for "${b.title}" to ${b.attendeeEmail}.`);
          await this.dispatchBookingNotification('BOOKING_REMINDER', { ...b, reminder1hSentAt: sentAt }, profile, origin, '1 hour');
        }
      }

      // Refresh ICS feed if enabled
      const icsInt = this.getIntegration('ics_feed');
      if (icsInt?.enabled && icsInt.config.feedUrl) {
        await this.syncExternalIcsFeed();
      }
    }

    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const now = Date.now();
    let nextMs: number | null = null;

    const consider = (candidate: number) => {
      const clamped = Math.max(now + 15_000, candidate);
      if (nextMs === null || clamped < nextMs) {
        nextMs = clamped;
      }
    };

    const bookings = this.listBookings();
    for (const b of bookings) {
      const startMs = Date.parse(b.startUtc);
      if (Number.isNaN(startMs)) continue;

      if (b.status === 'pending' && startMs > now) {
        consider(startMs);
      } else if (b.status === 'confirmed' && startMs > now) {
        if (!b.reminder24hSentAt && startMs - 24 * 3600_000 > now) {
          consider(startMs - 24 * 3600_000);
        }
        if (!b.reminder1hSentAt && startMs - 60 * 60_000 > now) {
          consider(startMs - 60 * 60_000);
        }
      }
    }

    const icsInt = this.getIntegration('ics_feed');
    if (icsInt?.enabled && icsInt.config.feedUrl) {
      consider(now + 30 * 60_000); // Re-sync ICS every 30 min
    }

    if (nextMs !== null) {
      await this.ctx.storage.setAlarm(nextMs);
    }
  }

  private async initHost(body: {
    hostId: string;
    username: string;
    name: string;
    email: string;
    timezone?: string;
    weeklyHours?: WeeklyHours;
    createStarterEvents?: boolean;
  }): Promise<Response> {
    const existing = this.getProfile();
    if (existing) return json({ profile: existing });

    const tz = safeTimeZone(body.timezone || 'UTC');
    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO profile (id, host_id, username, name, email, bio, timezone, time_format, brand_color, avatar_color, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, '12h', '#111827', '#ea580c', ?)`,
      body.hostId,
      body.username,
      body.name,
      body.email,
      'Book a time that works for you. Powered by Cloudflare Workers & Durable Objects.',
      tz,
      createdAt,
    );

    const scheduleId = `sch_${randomToken(6)}`;
    this.sql.exec(
      `INSERT INTO schedules (id, name, timezone, is_default, weekly_hours_json, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      scheduleId,
      'Working Hours',
      tz,
      JSON.stringify(body.weeklyHours ?? DEFAULT_WEEKLY_HOURS),
      createdAt,
    );

    if (body.createStarterEvents !== false) {
      const starters = [
        {
          slug: '15min',
          title: '15 Min Quick Chat',
          description: 'A short intro call to say hello and see how we can help.',
          duration: 15,
          interval: 15,
          color: '#2563eb',
        },
        {
          slug: '30min',
          title: '30 Min Meeting',
          description: 'Standard 30-minute video meeting for product demos or project syncs.',
          duration: 30,
          interval: 30,
          color: '#111827',
        },
        {
          slug: '60min',
          title: '60 Min Deep Dive',
          description: 'Extended working session for architecture reviews or consultations.',
          duration: 60,
          interval: 30,
          color: '#059669',
        },
      ];

      for (const s of starters) {
        this.sql.exec(
          `INSERT INTO event_types (
             id, slug, title, description, duration_minutes, buffer_before_minutes,
             buffer_after_minutes, minimum_notice_minutes, max_future_days,
             slot_interval_minutes, location_type, location_value, requires_confirmation,
             color, hidden, schedule_id, custom_questions_json, created_at
           ) VALUES (?, ?, ?, ?, ?, 0, 5, 60, 60, ?, 'jitsi', '', 0, ?, 0, ?, '[]', ?)`,
          `evt_${randomToken(6)}`,
          s.slug,
          s.title,
          s.description,
          s.duration,
          s.interval,
          s.color,
          scheduleId,
          createdAt,
        );
      }
    }

    this.logActivity('system', `Initialized Durable Object SQLite workspace for @${body.username}.`);
    return json({ profile: this.getProfile(), schedules: this.listSchedules(), eventTypes: this.listEventTypes() }, 201);
  }

  private async createBooking(
    body: {
      eventTypeSlug: string;
      startUtc: string;
      attendeeName: string;
      attendeeEmail: string;
      attendeeTimezone: string;
      attendeeNotes?: string;
      customAnswers?: Record<string, string>;
    },
    origin: string,
  ): Promise<Response> {
    const profile = this.getProfile();
    if (!profile) return json({ error: 'Host not found.' }, 404);

    const attendeeName = (body.attendeeName || '').trim();
    const attendeeEmail = (body.attendeeEmail || '').trim().toLowerCase();
    if (!attendeeName || !attendeeEmail.includes('@')) {
      return json({ error: 'Attendee name and a valid email address are required.' }, 400);
    }

    const eventType = this.getEventTypeBySlug(body.eventTypeSlug);
    if (!eventType || eventType.hidden) {
      return json({ error: 'Event type not found.' }, 404);
    }

    const schedule = this.getScheduleById(eventType.scheduleId) ?? this.getDefaultSchedule();
    if (!schedule) {
      return json({ error: 'Host has no availability schedule.' }, 400);
    }

    const uid = randomUid('bk');
    const meetingUrl = await this.resolveMeetingUrl(eventType, uid);
    const locationDisplay = eventType.locationValue || LOCATION_LABELS[eventType.locationType] || 'Online';

    // ATOMIC TRANSACTION inside the single-threaded Durable Object:
    // Re-checks availability & conflicts and writes in one synchronous SQLite transaction,
    // making double-bookings mathematically impossible.
    const txResult = this.ctx.storage.transactionSync<
      { ok: true; booking: Booking } | { ok: false; reason: string; code: number }
    >(() => {
      const currentBookings = this.listBookings();
      const blockedIntervals = this.listBlockedIntervals();
      const check = isSlotBookable({
        startUtc: body.startUtc,
        eventType,
        schedule,
        bookings: currentBookings,
        blockedIntervals,
      });

      if (!check.ok) {
        return check;
      }

      const nowIso = new Date().toISOString();
      const id = `b_${randomToken(8)}`;
      const cancelToken = randomToken(16);
      const rescheduleToken = randomToken(16);
      const status = eventType.requiresConfirmation ? 'pending' : 'confirmed';
      const title = `${eventType.title} between ${profile.name} and ${attendeeName}`;
      const attendeeTz = safeTimeZone(body.attendeeTimezone || 'UTC');

      const booking: Booking = {
        id,
        uid,
        eventTypeId: eventType.id,
        eventTypeTitle: eventType.title,
        eventTypeSlug: eventType.slug,
        title,
        startUtc: new Date(Date.parse(body.startUtc)).toISOString(),
        endUtc: check.endUtc,
        durationMinutes: eventType.durationMinutes,
        status,
        attendeeName,
        attendeeEmail,
        attendeeTimezone: attendeeTz,
        attendeeNotes: (body.attendeeNotes || '').trim(),
        customAnswers: body.customAnswers ?? {},
        locationType: eventType.locationType,
        locationDisplay,
        meetingUrl,
        cancelToken,
        rescheduleToken,
        cancellationReason: '',
        reminder24hSentAt: null,
        reminder1hSentAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      this.sql.exec(
        `INSERT INTO bookings (
           id, uid, event_type_id, event_type_title, event_type_slug, title,
           start_utc, end_utc, duration_minutes, status, attendee_name, attendee_email,
           attendee_timezone, attendee_notes, custom_answers_json, location_type,
           location_display, meeting_url, cancel_token, reschedule_token,
           cancellation_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        booking.id,
        booking.uid,
        booking.eventTypeId,
        booking.eventTypeTitle,
        booking.eventTypeSlug,
        booking.title,
        booking.startUtc,
        booking.endUtc,
        booking.durationMinutes,
        booking.status,
        booking.attendeeName,
        booking.attendeeEmail,
        booking.attendeeTimezone,
        booking.attendeeNotes,
        JSON.stringify(booking.customAnswers),
        booking.locationType,
        booking.locationDisplay,
        booking.meetingUrl,
        booking.cancelToken,
        booking.rescheduleToken,
        booking.createdAt,
        booking.updatedAt,
      );

      this.logActivity(
        'booking',
        `New ${status} booking "${eventType.title}" by ${attendeeName} (${attendeeEmail}).`,
      );

      return { ok: true, booking };
    });

    if (!txResult.ok) {
      return json({ error: txResult.reason }, txResult.code);
    }

    await this.scheduleNextAlarm();
    this.ctx.waitUntil(
      this.dispatchBookingNotification('BOOKING_CREATED', txResult.booking, profile, origin),
    );

    return json({ booking: txResult.booking, hostId: profile.id }, 201);
  }

  private async confirmBooking(id: string, origin: string): Promise<Response> {
    const booking = this.getBookingById(id);
    const profile = this.getProfile();
    if (!booking || !profile) return json({ error: 'Booking not found.' }, 404);
    if (booking.status === 'cancelled') {
      return json({ error: 'Cancelled bookings cannot be confirmed.' }, 400);
    }

    const updatedAt = new Date().toISOString();
    this.sql.exec(
      `UPDATE bookings SET status = 'confirmed', updated_at = ? WHERE id = ?`,
      updatedAt,
      id,
    );
    const updated = this.getBookingById(id)!;
    this.logActivity('booking', `Host confirmed booking ${updated.uid} (${updated.attendeeName}).`);
    await this.scheduleNextAlarm();
    this.ctx.waitUntil(this.dispatchBookingNotification('BOOKING_CONFIRMED', updated, profile, origin));
    return json({ booking: updated });
  }

  private async cancelBooking(
    uid: string,
    body: { token?: string; reason?: string; asHost?: boolean },
    origin: string,
  ): Promise<Response> {
    const booking = this.getBookingByUid(uid);
    const profile = this.getProfile();
    if (!booking || !profile) return json({ error: 'Booking not found.' }, 404);

    if (!body.asHost && body.token !== booking.cancelToken) {
      return json({ error: 'Invalid cancellation token.' }, 403);
    }

    const updatedAt = new Date().toISOString();
    const reason = (body.reason || '').trim();
    this.sql.exec(
      `UPDATE bookings SET status = 'cancelled', cancellation_reason = ?, updated_at = ? WHERE id = ?`,
      reason,
      updatedAt,
      booking.id,
    );
    const updated = this.getBookingById(booking.id)!;
    this.logActivity('booking', `Booking ${updated.uid} cancelled${reason ? `: ${reason}` : ''}.`);
    await this.scheduleNextAlarm();
    this.ctx.waitUntil(this.dispatchBookingNotification('BOOKING_CANCELLED', updated, profile, origin));
    return json({ booking: body.asHost ? updated : toPublicBooking(updated, true) });
  }

  private async rescheduleBooking(
    uid: string,
    body: { token?: string; newStartUtc: string; attendeeTimezone?: string; asHost?: boolean },
    origin: string,
  ): Promise<Response> {
    const existing = this.getBookingByUid(uid);
    const profile = this.getProfile();
    if (!existing || !profile) return json({ error: 'Booking not found.' }, 404);
    if (existing.status === 'cancelled') {
      return json({ error: 'Cannot reschedule a cancelled booking.' }, 400);
    }
    if (!body.asHost && body.token !== existing.rescheduleToken) {
      return json({ error: 'Invalid reschedule token.' }, 403);
    }

    const eventType =
      this.getEventTypeById(existing.eventTypeId) ?? this.getEventTypeBySlug(existing.eventTypeSlug);
    if (!eventType) return json({ error: 'Associated event type no longer exists.' }, 404);

    const schedule = this.getScheduleById(eventType.scheduleId) ?? this.getDefaultSchedule();
    if (!schedule) return json({ error: 'No availability schedule configured.' }, 400);

    const txResult = this.ctx.storage.transactionSync<
      { ok: true; booking: Booking } | { ok: false; reason: string; code: number }
    >(() => {
      const check = isSlotBookable({
        startUtc: body.newStartUtc,
        eventType,
        schedule,
        bookings: this.listBookings(),
        blockedIntervals: this.listBlockedIntervals(),
        excludeBookingId: existing.id,
      });

      if (!check.ok) return check;

      const updatedAt = new Date().toISOString();
      const nextStart = new Date(Date.parse(body.newStartUtc)).toISOString();
      const nextTz = body.attendeeTimezone
        ? safeTimeZone(body.attendeeTimezone)
        : existing.attendeeTimezone;

      this.sql.exec(
        `UPDATE bookings
         SET start_utc = ?, end_utc = ?, attendee_timezone = ?,
             reminder_24h_sent_at = NULL, reminder_1h_sent_at = NULL, updated_at = ?
         WHERE id = ?`,
        nextStart,
        check.endUtc,
        nextTz,
        updatedAt,
        existing.id,
      );

      const updated = this.getBookingById(existing.id)!;
      this.logActivity('booking', `Rescheduled booking ${updated.uid} to ${nextStart}.`);
      return { ok: true, booking: updated };
    });

    if (!txResult.ok) {
      return json({ error: txResult.reason }, txResult.code);
    }

    await this.scheduleNextAlarm();
    this.ctx.waitUntil(
      this.dispatchBookingNotification('BOOKING_RESCHEDULED', txResult.booking, profile, origin),
    );
    return json({
      booking: body.asHost ? txResult.booking : toPublicBooking(txResult.booking, true),
    });
  }

  private async resolveMeetingUrl(eventType: EventType, uid: string): Promise<string> {
    if (eventType.locationType === 'custom_link' || eventType.locationType === 'zoom' || eventType.locationType === 'google_meet') {
      if (eventType.locationValue) return eventType.locationValue;
      const providerKey: IntegrationProvider | null =
        eventType.locationType === 'zoom'
          ? 'zoom_link'
          : eventType.locationType === 'google_meet'
            ? 'google_meet'
            : null;
      if (providerKey) {
        const cfg = this.getIntegration(providerKey);
        if (cfg?.enabled && cfg.config.meetingUrl) return cfg.config.meetingUrl;
      }
      return '';
    }

    if (eventType.locationType === 'jitsi') {
      return `https://meet.jit.si/edgecal-${uid}`;
    }

    if (eventType.locationType === 'daily') {
      const dailyCfg = this.getIntegration('daily_video');
      const apiKey = dailyCfg?.config?.apiKey || this.env.DAILY_API_KEY;
      if (apiKey) {
        try {
          const resp = await fetch('https://api.daily.co/v1/rooms', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: `edgecal-${uid}`,
              properties: { enable_knocking: true, exp: Math.floor(Date.now() / 1000) + 86400 * 30 },
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as { url?: string };
            if (data.url) return data.url;
          }
        } catch {
          // Fall through to Jitsi room fallback
        }
      }
      return eventType.locationValue || `https://meet.jit.si/edgecal-${uid}`;
    }

    return '';
  }

  private async syncExternalIcsFeed(): Promise<{ ok: boolean; count: number; error?: string }> {
    const icsInt = this.getIntegration('ics_feed');
    const feedUrl = icsInt?.config?.feedUrl?.trim();
    if (!icsInt?.enabled || !feedUrl) {
      this.sql.exec(`DELETE FROM blocked_slots WHERE source = 'ics_feed'`);
      return { ok: true, count: 0 };
    }

    try {
      const resp = await fetch(feedUrl, { headers: { 'User-Agent': 'EdgeCal-Workers/1.0' } });
      if (!resp.ok) {
        return { ok: false, count: 0, error: `ICS feed returned HTTP ${resp.status}.` };
      }
      const text = await resp.text();
      const now = Date.now();
      const intervals = parseIcsBusyIntervals(
        text,
        'ics_feed',
        now - 24 * 3600_000,
        now + 90 * 86400_000,
      );

      this.ctx.storage.transactionSync(() => {
        this.sql.exec(`DELETE FROM blocked_slots WHERE source = 'ics_feed'`);
        for (const item of intervals.slice(0, 500)) {
          this.sql.exec(
            'INSERT OR REPLACE INTO blocked_slots (id, source, title, start_utc, end_utc) VALUES (?, ?, ?, ?, ?)',
            item.id,
            item.source,
            item.title,
            item.startUtc,
            item.endUtc,
          );
        }
      });

      this.logActivity('sync', `Synced ${intervals.length} busy interval(s) from external ICS calendar.`);
      return { ok: true, count: intervals.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch ICS feed';
      this.logActivity('sync', `ICS sync error: ${msg}`);
      return { ok: false, count: 0, error: msg };
    }
  }

  private async dispatchBookingNotification(
    event: WebhookEventType,
    booking: Booking,
    profile: HostProfile,
    origin: string,
    reminderLabel?: string,
  ): Promise<void> {
    // 1. Deliver matching webhooks
    const webhooks = this.listWebhooks().filter((w) => w.active && w.events.includes(event));
    await Promise.allSettled(
      webhooks.map((w) =>
        this.deliverWebhook(w, event, {
          event,
          booking,
          host: { username: profile.username, name: profile.name },
          manageUrl: `${origin.replace(/\/$/, '')}/booking/${booking.uid}`,
        }),
      ),
    );

    // 2. Deliver email natively via Cloudflare Workers Email Sending (`env.SEND_EMAIL` binding)
    if (!this.env.SEND_EMAIL) return;

    const cfEmail = this.getIntegration('cloudflare_email');
    if (cfEmail && !cfEmail.enabled) return;

    const fromEmail = (cfEmail?.config.fromEmail || this.env.EMAIL_FROM || '').trim();
    const fromName = (cfEmail?.config.fromName || this.env.EMAIL_FROM_NAME || this.env.APP_NAME || 'EdgeCal').trim();
    if (!fromEmail || !fromEmail.includes('@')) return;

    const sendToGuests = cfEmail?.config.sendToGuests !== 'false';
    const recipients = sendToGuests
      ? Array.from(new Set([booking.attendeeEmail, profile.email].filter(Boolean)))
      : [profile.email].filter(Boolean);

    const manageParams = new URLSearchParams({
      cancelToken: booking.cancelToken,
      rescheduleToken: booking.rescheduleToken,
    });
    const manageUrl = `${origin.replace(/\/$/, '')}/booking/${booking.uid}?${manageParams.toString()}`;
    const whenAtt = `${formatDateLong(booking.startUtc, booking.attendeeTimezone)} at ${formatSlotTime(booking.startUtc, booking.attendeeTimezone, '12h')} (${booking.attendeeTimezone})`;
    const subjectMap: Record<WebhookEventType, string> = {
      BOOKING_CREATED: booking.status === 'pending'
        ? `Booking request received: ${booking.title}`
        : `Confirmed: ${booking.title}`,
      BOOKING_CONFIRMED: `Confirmed: ${booking.title}`,
      BOOKING_CANCELLED: `Cancelled: ${booking.title}`,
      BOOKING_RESCHEDULED: `Rescheduled: ${booking.title}`,
      BOOKING_REMINDER: `Reminder (${reminderLabel || 'upcoming'}): ${booking.title}`,
    };

    const subject = subjectMap[event];
    const text = [
      subject,
      `When: ${whenAtt}`,
      `Location: ${booking.meetingUrl || booking.locationDisplay}`,
      booking.attendeeNotes ? `Notes: ${booking.attendeeNotes}` : '',
      `View / Manage Booking: ${manageUrl}`,
    ]
      .filter(Boolean)
      .join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
        <h2 style="margin-bottom: 8px;">${escapeHtml(subject)}</h2>
        <p style="color: #4b5563;"><strong>When:</strong> ${escapeHtml(whenAtt)}</p>
        <p style="color: #4b5563;"><strong>Location:</strong> ${escapeHtml(booking.meetingUrl || booking.locationDisplay)}</p>
        ${booking.attendeeNotes ? `<p style="color: #4b5563;"><strong>Notes:</strong> ${escapeHtml(booking.attendeeNotes)}</p>` : ''}
        <p style="margin-top: 20px;">
          <a href="${escapeHtml(manageUrl)}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">
            View / Manage Booking
          </a>
        </p>
      </div>
    `;

    const icsContent = generateBookingIcs(booking, profile, origin);
    const icsMethod = booking.status === 'cancelled' ? 'CANCEL' : 'REQUEST';

    await Promise.allSettled(
      recipients.map(async (to) => {
        try {
          await this.env.SEND_EMAIL!.send({
            from: { name: fromName, email: fromEmail },
            to,
            replyTo: profile.email,
            subject,
            text,
            html,
            attachments: [
              {
                disposition: 'attachment',
                filename: `booking-${booking.uid}.ics`,
                type: `text/calendar; charset=utf-8; method=${icsMethod}`,
                content: icsContent,
              },
            ],
          });
          this.logActivity('system', `Sent ${event} email via Cloudflare Email to ${to}.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Cloudflare Email send failed';
          this.logActivity('system', `Cloudflare Email skipped for ${to}: ${msg}`);
        }
      }),
    );
  }

  private async deliverWebhook(
    webhook: WebhookConfig,
    event: WebhookEventType,
    payload: unknown,
  ): Promise<number> {
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), payload });
    const sig = await signHmacSha256(webhook.secret, body);
    let status = 0;
    try {
      const resp = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeCal-Event': event,
          'X-EdgeCal-Signature-256': `sha256=${sig}`,
        },
        body,
      });
      status = resp.status;
    } catch {
      status = 0;
    }

    const nowIso = new Date().toISOString();
    this.sql.exec(
      'UPDATE webhooks SET last_status = ?, last_triggered_at = ? WHERE id = ?',
      status,
      nowIso,
      webhook.id,
    );
    this.logActivity('webhook', `Delivered ${event} to ${webhook.url} (HTTP ${status || 'ERR'}).`);
    return status;
  }

  // ---- CRUD helpers ----

  private createEventType(body: Partial<EventType>): Response {
    const title = (body.title || '').trim();
    if (!title) return json({ error: 'Event title is required.' }, 400);

    const baseSlug = slugify(body.slug || title) || `event-${randomToken(3)}`;
    let slug = baseSlug;
    let suffix = 2;
    while (this.getEventTypeBySlug(slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const defaultSchedule = this.getDefaultSchedule();
    const scheduleId = body.scheduleId || defaultSchedule?.id || '';
    const id = `evt_${randomToken(6)}`;
    const createdAt = new Date().toISOString();
    const duration = safeInt(body.durationMinutes, 30, 5, 480);
    const slotInterval = safeInt(body.slotIntervalMinutes, duration, 5, 240);

    this.sql.exec(
      `INSERT INTO event_types (
         id, slug, title, description, duration_minutes, buffer_before_minutes,
         buffer_after_minutes, minimum_notice_minutes, max_future_days,
         slot_interval_minutes, location_type, location_value, requires_confirmation,
         color, hidden, schedule_id, custom_questions_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      title,
      body.description ?? '',
      duration,
      safeInt(body.bufferBeforeMinutes, 0, 0),
      safeInt(body.bufferAfterMinutes, 0, 0),
      safeInt(body.minimumNoticeMinutes, 60, 0),
      safeInt(body.maxFutureDays, 60, 1),
      slotInterval,
      body.locationType ?? 'jitsi',
      body.locationValue ?? '',
      body.requiresConfirmation ? 1 : 0,
      body.color ?? '#111827',
      body.hidden ? 1 : 0,
      scheduleId,
      JSON.stringify(body.customQuestions ?? []),
      createdAt,
    );

    return json({ eventType: this.getEventTypeById(id) }, 201);
  }

  private updateEventType(id: string, body: Partial<EventType>): Response {
    const existing = this.getEventTypeById(id);
    if (!existing) return json({ error: 'Event type not found.' }, 404);

    const nextSlug = body.slug ? slugify(body.slug) : existing.slug;
    if (!nextSlug) return json({ error: 'Slug cannot be empty.' }, 400);
    const conflict = this.getEventTypeBySlug(nextSlug);
    if (conflict && conflict.id !== id) {
      return json({ error: 'Another event type already uses that URL slug.' }, 409);
    }

    this.sql.exec(
      `UPDATE event_types SET
         slug = ?, title = ?, description = ?, duration_minutes = ?,
         buffer_before_minutes = ?, buffer_after_minutes = ?,
         minimum_notice_minutes = ?, max_future_days = ?,
         slot_interval_minutes = ?, location_type = ?, location_value = ?,
         requires_confirmation = ?, color = ?, hidden = ?,
         schedule_id = ?, custom_questions_json = ?
       WHERE id = ?`,
      nextSlug,
      body.title !== undefined ? body.title.trim() || existing.title : existing.title,
      body.description ?? existing.description,
      safeInt(body.durationMinutes, existing.durationMinutes, 5, 480),
      safeInt(body.bufferBeforeMinutes, existing.bufferBeforeMinutes, 0),
      safeInt(body.bufferAfterMinutes, existing.bufferAfterMinutes, 0),
      safeInt(body.minimumNoticeMinutes, existing.minimumNoticeMinutes, 0),
      safeInt(body.maxFutureDays, existing.maxFutureDays, 1),
      safeInt(body.slotIntervalMinutes, existing.slotIntervalMinutes, 5, 240),
      body.locationType ?? existing.locationType,
      body.locationValue ?? existing.locationValue,
      body.requiresConfirmation !== undefined ? (body.requiresConfirmation ? 1 : 0) : existing.requiresConfirmation ? 1 : 0,
      body.color ?? existing.color,
      body.hidden !== undefined ? (body.hidden ? 1 : 0) : existing.hidden ? 1 : 0,
      body.scheduleId ?? existing.scheduleId,
      JSON.stringify(body.customQuestions ?? existing.customQuestions),
      id,
    );

    return json({ eventType: this.getEventTypeById(id) });
  }

  private createSchedule(body: {
    name: string;
    timezone?: string;
    isDefault?: boolean;
    weeklyHours?: WeeklyHours;
  }): Response {
    const name = (body.name || '').trim() || 'Custom Schedule';
    const profile = this.getProfile();
    const tz = safeTimeZone(body.timezone || profile?.timezone || 'UTC');
    const id = `sch_${randomToken(6)}`;
    const createdAt = new Date().toISOString();

    if (body.isDefault) {
      this.sql.exec('UPDATE schedules SET is_default = 0');
    }

    this.sql.exec(
      `INSERT INTO schedules (id, name, timezone, is_default, weekly_hours_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      name,
      tz,
      body.isDefault ? 1 : 0,
      JSON.stringify(body.weeklyHours ?? DEFAULT_WEEKLY_HOURS),
      createdAt,
    );

    return json({ schedule: this.getScheduleById(id) }, 201);
  }

  private updateSchedule(id: string, body: Partial<AvailabilitySchedule>): Response {
    const existing = this.getScheduleById(id);
    if (!existing) return json({ error: 'Schedule not found.' }, 404);

    if (body.isDefault) {
      this.sql.exec('UPDATE schedules SET is_default = 0');
    }

    this.sql.exec(
      `UPDATE schedules SET name = ?, timezone = ?, is_default = ?, weekly_hours_json = ? WHERE id = ?`,
      body.name !== undefined ? body.name.trim() || existing.name : existing.name,
      body.timezone ? safeTimeZone(body.timezone) : existing.timezone,
      body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
      JSON.stringify(body.weeklyHours ?? existing.weeklyHours),
      id,
    );

    return json({ schedule: this.getScheduleById(id) });
  }

  private upsertDateOverride(
    scheduleId: string,
    body: { dateYmd: string; unavailable: boolean; ranges?: TimeRange[]; label?: string },
  ): Response {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dateYmd || '')) {
      return json({ error: 'Date must be formatted YYYY-MM-DD.' }, 400);
    }

    this.sql.exec(
      'DELETE FROM date_overrides WHERE schedule_id = ? AND date_ymd = ?',
      scheduleId,
      body.dateYmd,
    );

    const id = `ovr_${randomToken(6)}`;
    this.sql.exec(
      `INSERT INTO date_overrides (id, schedule_id, date_ymd, unavailable, ranges_json, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      scheduleId,
      body.dateYmd,
      body.unavailable ? 1 : 0,
      JSON.stringify(body.unavailable ? [] : body.ranges ?? []),
      body.label ?? '',
    );

    return json({ schedule: this.getScheduleById(scheduleId) }, 201);
  }

  // ---- SQLite Row Readers ----

  private getMeta(key: string): string | null {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ? LIMIT 1', key)
      .toArray()[0];
    return row ? row.value : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  private getProfile(): HostProfile | null {
    const row = this.sql
      .exec<{
        host_id: string;
        username: string;
        name: string;
        email: string;
        bio: string;
        timezone: string;
        time_format: string;
        brand_color: string;
        avatar_color: string;
        created_at: string;
      }>('SELECT * FROM profile WHERE id = 1')
      .toArray()[0];
    if (!row) return null;
    return {
      id: row.host_id,
      username: row.username,
      name: row.name,
      email: row.email,
      bio: row.bio,
      timezone: row.timezone,
      timeFormat: (row.time_format === '24h' ? '24h' : '12h') as TimeFormat,
      brandColor: row.brand_color,
      avatarColor: row.avatar_color,
      createdAt: row.created_at,
    };
  }

  private mapEventTypeRow(r: Record<string, SqlStorageValue>): EventType {
    return {
      id: String(r.id),
      slug: String(r.slug),
      title: String(r.title),
      description: String(r.description ?? ''),
      durationMinutes: Number(r.duration_minutes),
      bufferBeforeMinutes: Number(r.buffer_before_minutes),
      bufferAfterMinutes: Number(r.buffer_after_minutes),
      minimumNoticeMinutes: Number(r.minimum_notice_minutes),
      maxFutureDays: Number(r.max_future_days),
      slotIntervalMinutes: Number(r.slot_interval_minutes),
      locationType: String(r.location_type) as LocationType,
      locationValue: String(r.location_value ?? ''),
      requiresConfirmation: Boolean(r.requires_confirmation),
      color: String(r.color ?? '#111827'),
      hidden: Boolean(r.hidden),
      scheduleId: String(r.schedule_id),
      customQuestions: safeParseJson<CustomQuestion[]>(String(r.custom_questions_json ?? '[]'), []),
      createdAt: String(r.created_at),
    };
  }

  private listEventTypes(): EventType[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM event_types ORDER BY created_at ASC')
      .toArray()
      .map((r) => this.mapEventTypeRow(r));
  }

  private getEventTypeById(id: string): EventType | null {
    const r = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM event_types WHERE id = ? LIMIT 1', id)
      .toArray()[0];
    return r ? this.mapEventTypeRow(r) : null;
  }

  private getEventTypeBySlug(slug: string): EventType | null {
    const r = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM event_types WHERE slug = ? LIMIT 1', slug)
      .toArray()[0];
    return r ? this.mapEventTypeRow(r) : null;
  }

  private listSchedules(): AvailabilitySchedule[] {
    const overrides = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM date_overrides ORDER BY date_ymd ASC')
      .toArray()
      .map<DateOverride>((o) => ({
        id: String(o.id),
        scheduleId: String(o.schedule_id),
        dateYmd: String(o.date_ymd),
        unavailable: Boolean(o.unavailable),
        ranges: safeParseJson<TimeRange[]>(String(o.ranges_json ?? '[]'), []),
        label: String(o.label ?? ''),
      }));

    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM schedules ORDER BY is_default DESC, created_at ASC')
      .toArray()
      .map<AvailabilitySchedule>((s) => ({
        id: String(s.id),
        name: String(s.name),
        timezone: String(s.timezone),
        isDefault: Boolean(s.is_default),
        weeklyHours: safeParseJson<WeeklyHours>(String(s.weekly_hours_json), DEFAULT_WEEKLY_HOURS),
        dateOverrides: overrides.filter((o) => o.scheduleId === String(s.id)),
        createdAt: String(s.created_at),
      }));
  }

  private getScheduleById(id: string): AvailabilitySchedule | null {
    return this.listSchedules().find((s) => s.id === id) ?? null;
  }

  private getDefaultSchedule(): AvailabilitySchedule | null {
    const all = this.listSchedules();
    return all.find((s) => s.isDefault) ?? all[0] ?? null;
  }

  private mapBookingRow(r: Record<string, SqlStorageValue>): Booking {
    return {
      id: String(r.id),
      uid: String(r.uid),
      eventTypeId: String(r.event_type_id),
      eventTypeTitle: String(r.event_type_title),
      eventTypeSlug: String(r.event_type_slug),
      title: String(r.title),
      startUtc: String(r.start_utc),
      endUtc: String(r.end_utc),
      durationMinutes: Number(r.duration_minutes),
      status: String(r.status) as Booking['status'],
      attendeeName: String(r.attendee_name),
      attendeeEmail: String(r.attendee_email),
      attendeeTimezone: String(r.attendee_timezone),
      attendeeNotes: String(r.attendee_notes ?? ''),
      customAnswers: safeParseJson<Record<string, string>>(String(r.custom_answers_json ?? '{}'), {}),
      locationType: String(r.location_type) as LocationType,
      locationDisplay: String(r.location_display ?? ''),
      meetingUrl: String(r.meeting_url ?? ''),
      cancelToken: String(r.cancel_token),
      rescheduleToken: String(r.reschedule_token),
      cancellationReason: String(r.cancellation_reason ?? ''),
      reminder24hSentAt: r.reminder_24h_sent_at ? String(r.reminder_24h_sent_at) : null,
      reminder1hSentAt: r.reminder_1h_sent_at ? String(r.reminder_1h_sent_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private listBookings(): Booking[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM bookings ORDER BY start_utc ASC')
      .toArray()
      .map((r) => this.mapBookingRow(r));
  }

  private getBookingById(id: string): Booking | null {
    const r = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM bookings WHERE id = ? LIMIT 1', id)
      .toArray()[0];
    return r ? this.mapBookingRow(r) : null;
  }

  private getBookingByUid(uid: string): Booking | null {
    const r = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM bookings WHERE uid = ? LIMIT 1', uid)
      .toArray()[0];
    return r ? this.mapBookingRow(r) : null;
  }

  private listWebhooks(): WebhookConfig[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM webhooks ORDER BY created_at DESC')
      .toArray()
      .map((r) => ({
        id: String(r.id),
        url: String(r.url),
        secret: String(r.secret),
        events: safeParseJson<WebhookEventType[]>(String(r.events_json), []),
        active: Boolean(r.active),
        lastStatus: r.last_status !== null && r.last_status !== undefined ? Number(r.last_status) : null,
        lastTriggeredAt: r.last_triggered_at ? String(r.last_triggered_at) : null,
        createdAt: String(r.created_at),
      }));
  }

  private listIntegrations(): IntegrationConfig[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM integrations')
      .toArray()
      .map((r) => ({
        provider: String(r.provider) as IntegrationProvider,
        enabled: Boolean(r.enabled),
        config: safeParseJson<Record<string, string>>(String(r.config_json ?? '{}'), {}),
        updatedAt: String(r.updated_at),
      }));
  }

  private getIntegration(provider: IntegrationProvider): IntegrationConfig | null {
    return this.listIntegrations().find((i) => i.provider === provider) ?? null;
  }

  private listBlockedIntervals(): BlockedInterval[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM blocked_slots ORDER BY start_utc ASC')
      .toArray()
      .map((r) => ({
        id: String(r.id),
        source: String(r.source),
        title: String(r.title),
        startUtc: String(r.start_utc),
        endUtc: String(r.end_utc),
      }));
  }

  private logActivity(kind: ActivityLogEntry['kind'], message: string): void {
    this.sql.exec(
      'INSERT INTO activity_log (id, kind, message, created_at) VALUES (?, ?, ?, ?)',
      `act_${randomToken(6)}`,
      kind,
      message,
      new Date().toISOString(),
    );
    // Keep only the latest 50 log entries
    this.sql.exec(`
      DELETE FROM activity_log WHERE id NOT IN (
        SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 50
      )
    `);
  }

  private async getDOStatus(): Promise<DOStatusInfo> {
    const profile = this.getProfile();
    const alarmMs = await this.ctx.storage.getAlarm();
    const bookings = this.listBookings();
    const now = Date.now();
    const upcoming = bookings.filter((b) => b.status !== 'cancelled' && Date.parse(b.endUtc) > now).length;

    const recentActivity = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 15')
      .toArray()
      .map<ActivityLogEntry>((r) => ({
        id: String(r.id),
        kind: String(r.kind) as ActivityLogEntry['kind'],
        message: String(r.message),
        createdAt: String(r.created_at),
      }));

    return {
      runtime: 'cloudflare-durable-object',
      durableObjectClass: 'HostSchedulerDO (SQLite)',
      hostId: profile?.id ?? 'uninitialized',
      nextAlarmUtc: alarmMs ? new Date(alarmMs).toISOString() : null,
      counts: {
        eventTypes: this.listEventTypes().length,
        schedules: this.listSchedules().length,
        bookingsTotal: bookings.length,
        bookingsUpcoming: upcoming,
        webhooks: this.listWebhooks().length,
        blockedSlots: this.listBlockedIntervals().length,
      },
      recentActivity,
    };
  }
}
