import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker, { DirectoryDO, HostSchedulerDO } from '../index';
import type { Env } from '../env';

/**
 * Minimal faithful Cloudflare SqlStorage + DurableObjectState shim backed by
 * Node 22's native SQLite engine (`node:sqlite`) so we can execute the real
 * DirectoryDO, HostSchedulerDO, and Hono Worker routes end-to-end.
 */
function createSqliteDOState(): {
  state: DurableObjectState;
  getAlarmMs: () => number | null;
} {
  const db = new DatabaseSync(':memory:');
  let alarmMs: number | null = null;

  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      const trimmed = query.trim();
      // Multi-statement DDL (CREATE TABLE ...; CREATE INDEX ...)
      if (bindings.length === 0 && trimmed.includes(';') && /CREATE\s+(TABLE|INDEX)/i.test(trimmed)) {
        db.exec(trimmed);
        return {
          toArray: () => [],
          one: () => undefined,
        };
      }

      const stmt = db.prepare(trimmed);
      const isSelect = /^SELECT\b/i.test(trimmed);
      if (isSelect) {
        const rows = stmt.all(...(bindings as never[])) as Record<string, unknown>[];
        return {
          toArray: () => rows,
          one: () => rows[0],
        };
      }

      stmt.run(...(bindings as never[]));
      return {
        toArray: () => [],
        one: () => undefined,
      };
    },
  };

  const storage = {
    sql,
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const res = fn();
        db.exec('COMMIT');
        return res;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async setAlarm(scheduledTime: number | Date): Promise<void> {
      alarmMs = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
    },
    async getAlarm(): Promise<number | null> {
      return alarmMs;
    },
    async deleteAlarm(): Promise<void> {
      alarmMs = null;
    },
  };

  const state = {
    storage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: (_p: Promise<unknown>) => {},
  } as unknown as DurableObjectState;

  return { state, getAlarmMs: () => alarmMs };
}

function createNamespace<T extends { fetch(req: Request): Promise<Response>; alarm?: () => Promise<void> }>(
  factory: (state: DurableObjectState) => T,
) {
  const instances = new Map<string, { instance: T; getAlarmMs: () => number | null }>();

  const ns = {
    idFromName(name: string) {
      return { toString: () => name } as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = id.toString();
      let entry = instances.get(key);
      if (!entry) {
        const { state, getAlarmMs } = createSqliteDOState();
        entry = { instance: factory(state), getAlarmMs };
        instances.set(key, entry);
      }
      const target = entry.instance;
      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          target.fetch(input instanceof Request ? input : new Request(input, init)),
      } as unknown as DurableObjectStub;
    },
    _getEntry(name: string) {
      return instances.get(name);
    },
  };

  return ns;
}

describe('Cloudflare Worker + SQLite Durable Objects End-to-End', () => {
  function createTestEnv() {
    let envRef!: Env;
    const dirNs = createNamespace((s) => new DirectoryDO(s, envRef));
    const hostNs = createNamespace((s) => new HostSchedulerDO(s, envRef));
    const sentEmails: Array<{ to: unknown; subject?: string; html?: string; text?: string; attachments?: unknown[] }> = [];
    const waitUntilPromises: Promise<unknown>[] = [];

    const sendEmailMock = {
      async send(msg: { to: unknown; subject?: string; html?: string; text?: string; attachments?: unknown[] }) {
        sentEmails.push(msg);
        return { messageId: `cf_msg_${sentEmails.length}` };
      },
    } as unknown as SendEmail;

    envRef = {
      DIRECTORY_DO: dirNs as unknown as DurableObjectNamespace,
      HOST_SCHEDULER_DO: hostNs as unknown as DurableObjectNamespace,
      SEND_EMAIL: sendEmailMock,
      APP_NAME: 'EdgeCal',
      ALLOW_SIGNUPS: 'false',
      APP_URL: 'https://cal.example.workers.dev',
      EMAIL_FROM: 'bookings@example.com',
      EMAIL_FROM_NAME: 'EdgeCal',
    };
    return { env: envRef, dirNs, hostNs, sentEmails, waitUntilPromises };
  }

  async function req(
    env: Env,
    path: string,
    options?: { method?: string; body?: unknown; cookie?: string },
  ) {
    const headers: Record<string, string> = {};
    if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options?.cookie) headers['Cookie'] = options.cookie;
    return worker.fetch(
      new Request(`https://cal.example.workers.dev${path}`, {
        method: options?.method ?? 'GET',
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      }),
      env,
    );
  }

  it('runs full setup, slot lookup, atomic booking, double-booking rejection, Cloudflare Email + ICS, reschedule, DO alarm, and cancel', async () => {
    const { env, hostNs, sentEmails } = createTestEnv();

    // 1. Setup status before init
    const status0 = await (await req(env, '/api/setup/status')).json() as { setupCompleted: boolean };
    expect(status0.setupCompleted).toBe(false);

    // 2. Complete first-run setup
    const setupRes = await req(env, '/api/setup', {
      method: 'POST',
      body: {
        name: 'Jared Taylor',
        username: 'jared',
        email: 'jared@example.com',
        password: 'strong-password-123',
        timezone: 'UTC',
        weeklyHours: {
          0: [{ start: '08:00', end: '18:00' }],
          1: [{ start: '08:00', end: '18:00' }],
          2: [{ start: '08:00', end: '18:00' }],
          3: [{ start: '08:00', end: '18:00' }],
          4: [{ start: '08:00', end: '18:00' }],
          5: [{ start: '08:00', end: '18:00' }],
          6: [{ start: '08:00', end: '18:00' }],
        },
        createStarterEvents: true,
      },
    });
    expect(setupRes.status).toBe(201);
    const setCookieHeader = setupRes.headers.get('set-cookie') || '';
    const sessionCookie = setCookieHeader.split(';')[0];
    expect(sessionCookie).toContain('edgecal_session=');
    const setupBody = (await setupRes.json()) as { user: { id: string; username: string } };
    expect(setupBody.user.username).toBe('jared');

    // 3. Public host profile & slots
    const pubRes = await req(env, '/api/public/jared');
    expect(pubRes.status).toBe(200);
    const pubData = (await pubRes.json()) as { eventTypes: { slug: string }[] };
    expect(pubData.eventTypes.map((e) => e.slug)).toContain('30min');

    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    const ymd = tomorrow.toISOString().slice(0, 10);
    const slotsRes = await req(
      env,
      `/api/public/jared/slots?slug=30min&startDate=${ymd}&endDate=${ymd}&timeZone=UTC`,
    );
    expect(slotsRes.status).toBe(200);
    const slotsData = (await slotsRes.json()) as {
      slots: Record<string, { startUtc: string; endUtc: string }[]>;
    };
    const daySlots = slotsData.slots[ymd];
    expect(daySlots.length).toBeGreaterThanOrEqual(4);

    // 4. Create booking atomically
    const chosenSlot = daySlots[0];
    const bookRes = await req(env, '/api/public/jared/bookings', {
      method: 'POST',
      body: {
        eventTypeSlug: '30min',
        startUtc: chosenSlot.startUtc,
        attendeeName: 'Taylor Swift',
        attendeeEmail: 'taylor@example.com',
        attendeeTimezone: 'UTC',
        attendeeNotes: 'Testing Workers DO booking',
      },
    });
    expect(bookRes.status).toBe(201);
    const bookData = (await bookRes.json()) as {
      booking: { uid: string; cancelToken: string; rescheduleToken: string; status: string };
    };
    expect(bookData.booking.status).toBe('confirmed');

    // Verify a Durable Object Alarm was automatically scheduled for reminders!
    const hostEntry = hostNs._getEntry(setupBody.user.id);
    expect(hostEntry?.getAlarmMs()).not.toBeNull();

    // Flush microtasks so waitUntil email delivery completes, then verify Cloudflare SEND_EMAIL fired with .ics attachment
    await new Promise((r) => setTimeout(r, 10));
    expect(sentEmails.length).toBeGreaterThanOrEqual(2);
    expect(sentEmails[0].subject).toContain('Confirmed:');
    expect(sentEmails[0].attachments?.length).toBe(1);

    // 5. Attempt double-booking the EXACT same slot -> must reject with 409 Conflict!
    const dupRes = await req(env, '/api/public/jared/bookings', {
      method: 'POST',
      body: {
        eventTypeSlug: '30min',
        startUtc: chosenSlot.startUtc,
        attendeeName: 'Another Visitor',
        attendeeEmail: 'other@example.com',
        attendeeTimezone: 'UTC',
      },
    });
    expect(dupRes.status).toBe(409);

    // 6. Download RFC 5545 .ics calendar invite & host calendar feed
    const icsRes = await req(env, `/ics/${bookData.booking.uid}.ics`);
    expect(icsRes.status).toBe(200);
    const icsText = await icsRes.text();
    expect(icsText).toContain('BEGIN:VCALENDAR');
    expect(icsText).toContain(bookData.booking.uid);

    const feedRes = await req(env, '/api/public/jared/feed.ics');
    expect(feedRes.status).toBe(200);
    expect(await feedRes.text()).toContain('Taylor Swift');

    // 7. Reschedule to a later slot
    const laterSlot = daySlots[3];
    const reschRes = await req(env, `/api/bookings/public/${bookData.booking.uid}/reschedule`, {
      method: 'POST',
      body: {
        token: bookData.booking.rescheduleToken,
        newStartUtc: laterSlot.startUtc,
        attendeeTimezone: 'UTC',
      },
    });
    expect(reschRes.status).toBe(200);
    const reschData = (await reschRes.json()) as { booking: { startUtc: string } };
    expect(reschData.booking.startUtc).toBe(laterSlot.startUtc);

    // 8. Authenticated dashboard status reports live SQLite counts & DO alarm
    const dashStatus = await req(env, '/api/dashboard/status', { cookie: sessionCookie });
    expect(dashStatus.status).toBe(200);
    const dashJson = (await dashStatus.json()) as {
      runtime: string;
      counts: { bookingsUpcoming: number; eventTypes: number };
      nextAlarmUtc: string | null;
    };
    expect(dashJson.runtime).toBe('cloudflare-durable-object');
    expect(dashJson.counts.bookingsUpcoming).toBe(1);
    expect(dashJson.counts.eventTypes).toBe(3);
    expect(dashJson.nextAlarmUtc).not.toBeNull();

    // 9. Trigger Durable Object alarm() handler cleanly without errors
    await hostEntry?.instance.alarm?.();

    // 10. Cancel booking and confirm original slot is freed
    const cancelRes = await req(env, `/api/bookings/public/${bookData.booking.uid}/cancel`, {
      method: 'POST',
      body: {
        token: bookData.booking.cancelToken,
        reason: 'Plans changed',
      },
    });
    expect(cancelRes.status).toBe(200);
    const cancelData = (await cancelRes.json()) as { booking: { status: string } };
    expect(cancelData.booking.status).toBe('cancelled');

    // Re-booking the cancelled slot now succeeds!
    const rebookRes = await req(env, '/api/public/jared/bookings', {
      method: 'POST',
      body: {
        eventTypeSlug: '30min',
        startUtc: laterSlot.startUtc,
        attendeeName: 'Second Person',
        attendeeEmail: 'second@example.com',
        attendeeTimezone: 'UTC',
      },
    });
    expect(rebookRes.status).toBe(201);
  });

  it('protects public booking tokens/PII, defaults omitted minimumNoticeMinutes, escapes email HTML, and remembers origin for alarms', async () => {
    const { env, hostNs, sentEmails } = createTestEnv();
    // Simulate a deployment where APP_URL is NOT explicitly configured in wrangler.jsonc
    delete env.APP_URL;

    const setupRes = await req(env, '/api/setup', {
      method: 'POST',
      body: {
        name: 'Alex Host',
        username: 'alex',
        email: 'alex@example.com',
        password: 'strong-password-123',
        timezone: 'UTC',
        weeklyHours: {
          0: [{ start: '00:00', end: '23:59' }],
          1: [{ start: '00:00', end: '23:59' }],
          2: [{ start: '00:00', end: '23:59' }],
          3: [{ start: '00:00', end: '23:59' }],
          4: [{ start: '00:00', end: '23:59' }],
          5: [{ start: '00:00', end: '23:59' }],
          6: [{ start: '00:00', end: '23:59' }],
        },
        createStarterEvents: false,
      },
    });
    expect(setupRes.status).toBe(201);
    const sessionCookie = (setupRes.headers.get('set-cookie') || '').split(';')[0];
    const setupBody = (await setupRes.json()) as { user: { id: string } };

    // 1. Creating an event type WITHOUT minimumNoticeMinutes should default to 60 (never NaN/NULL)
    const etRes = await req(env, '/api/dashboard/event-types', {
      method: 'POST',
      cookie: sessionCookie,
      body: {
        title: 'Quick Intro',
        durationMinutes: 30,
      },
    });
    expect(etRes.status).toBe(201);
    const etData = (await etRes.json()) as { eventType: { slug: string; minimumNoticeMinutes: number } };
    expect(etData.eventType.minimumNoticeMinutes).toBe(60);

    // 2. Book a slot ~50 minutes before the 1h reminder window (30 min from now + 60 min notice => 2h from now? Pick 30 min -> need >= 60m notice, pick 2h from now -> wait: 1h reminder triggers <= 65m before start; let's update event to minimumNoticeMinutes: 0 so we can trigger 1h reminder via alarm!)
    const allEts = (await (await req(env, '/api/dashboard/event-types', { cookie: sessionCookie })).json()) as {
      eventTypes: { id: string }[];
    };
    await req(env, `/api/dashboard/event-types/${allEts.eventTypes[0].id}`, {
      method: 'PUT',
      cookie: sessionCookie,
      body: { minimumNoticeMinutes: 0 },
    });

    const startUtc = new Date(Date.now() + 45 * 60_000).toISOString();
    const bookRes = await req(env, '/api/public/alex/bookings', {
      method: 'POST',
      body: {
        eventTypeSlug: etData.eventType.slug,
        startUtc,
        attendeeName: 'Jamie <script>alert(1)</script>',
        attendeeEmail: 'jamie@example.com',
        attendeeTimezone: 'UTC',
        attendeeNotes: '<b>Important</b> & urgent',
      },
    });
    expect(bookRes.status).toBe(201);
    const created = (await bookRes.json()) as {
      booking: { uid: string; cancelToken: string; rescheduleToken: string };
    };

    await new Promise((r) => setTimeout(r, 10));
    // Verify HTML escaping and tokenized manageUrl in confirmation email
    expect(sentEmails[0].html).not.toContain('<script>');
    expect(sentEmails[0].html).toContain('&lt;script&gt;');
    expect(sentEmails[0].html).toContain('&lt;b&gt;Important&lt;/b&gt; &amp; urgent');
    expect(sentEmails[0].html).toContain(`cancelToken=${created.booking.cancelToken}`);

    // 3. Unauthenticated GET /api/bookings/public/:uid must NOT leak tokens or private PII
    const pubUnauthRes = await req(env, `/api/bookings/public/${created.booking.uid}`);
    expect(pubUnauthRes.status).toBe(200);
    const pubUnauth = (await pubUnauthRes.json()) as {
      booking: Record<string, unknown>;
      canCancel: boolean;
      canReschedule: boolean;
    };
    expect(pubUnauth.booking.cancelToken).toBeUndefined();
    expect(pubUnauth.booking.rescheduleToken).toBeUndefined();
    expect(pubUnauth.booking.attendeeEmail).toBe('');
    expect(pubUnauth.booking.attendeeNotes).toBe('');
    expect(pubUnauth.canCancel).toBe(false);
    expect(pubUnauth.canReschedule).toBe(false);

    // 4. GET with valid tokens reveals attendee details & enables actions, still without echoing tokens
    const pubAuthRes = await req(
      env,
      `/api/bookings/public/${created.booking.uid}?cancelToken=${created.booking.cancelToken}`,
    );
    expect(pubAuthRes.status).toBe(200);
    const pubAuth = (await pubAuthRes.json()) as {
      booking: Record<string, unknown>;
      canCancel: boolean;
      canReschedule: boolean;
    };
    expect(pubAuth.booking.cancelToken).toBeUndefined();
    expect(pubAuth.booking.attendeeEmail).toBe('jamie@example.com');
    expect(pubAuth.canCancel).toBe(true);
    expect(pubAuth.canReschedule).toBe(false);

    // 5. Public cancel without a token is rejected with 403
    const badCancel = await req(env, `/api/bookings/public/${created.booking.uid}/cancel`, {
      method: 'POST',
      body: { token: '', reason: 'hijack' },
    });
    expect(badCancel.status).toBe(403);

    // 6. Trigger alarm() without APP_URL set -> reminder email uses persisted origin https://cal.example.workers.dev
    const prevEmailCount = sentEmails.length;
    await hostNs._getEntry(setupBody.user.id)?.instance.alarm?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(sentEmails.length).toBeGreaterThan(prevEmailCount);
    const reminderEmail = sentEmails[prevEmailCount];
    expect(reminderEmail.text).toContain('https://cal.example.workers.dev/booking/');
    expect(reminderEmail.text).not.toContain('https://edgecal.workers.dev');
  });
});
