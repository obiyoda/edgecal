import {
  DEFAULT_WEEKLY_HOURS,
  LOCATION_LABELS,
  type ActivityLogEntry,
  type AvailabilitySchedule,
  type BlockedInterval,
  type Booking,
  type DOStatusInfo,
  type EventType,
  type HostProfile,
  type IntegrationConfig,
  type IntegrationProvider,
  type PublicBooking,
  type PublicBookingResponse,
  type PublicHostBundle,
  type SetupStatusResponse,
  type TimeRange,
  type TimeSlot,
  type WebhookConfig,
  type WebhookEventType,
  type WeeklyHours,
} from '../../shared/types';
import {
  computeAvailableSlotsByDate,
  isSlotBookable,
  safeTimeZone,
  slugify,
} from '../../shared/scheduling';
import { generateBookingIcs } from '../../shared/ics';
import { getLocalTimeZone } from '../../shared/timezones';

const STORAGE_KEY = 'edgecal_local_preview_v1';

interface LocalState {
  setupCompleted: boolean;
  loggedIn: boolean;
  password: string;
  profile: HostProfile;
  schedules: AvailabilitySchedule[];
  eventTypes: EventType[];
  bookings: Booking[];
  webhooks: WebhookConfig[];
  integrations: IntegrationConfig[];
  blockedSlots: BlockedInterval[];
  activity: ActivityLogEntry[];
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createInitialDemoState(): LocalState {
  const tz = getLocalTimeZone();
  const now = new Date();
  const nowIso = now.toISOString();
  const schId = 'sch_default';

  // Seed one upcoming sample booking 2 days from now at 10:00 AM UTC
  const sampleStart = new Date(now.getTime() + 48 * 3600_000);
  sampleStart.setUTCMinutes(0, 0, 0);
  sampleStart.setUTCHours(15);
  const sampleEnd = new Date(sampleStart.getTime() + 30 * 60_000);

  return {
    setupCompleted: true,
    loggedIn: true,
    password: 'demo',
    profile: {
      id: 'usr_local_demo',
      username: 'alex',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      bio: 'Product builder & independent consultant. Pick a time that works for you — zero back-and-forth emails.',
      timezone: tz,
      timeFormat: '12h',
      brandColor: '#111827',
      avatarColor: '#ea580c',
      createdAt: nowIso,
    },
    schedules: [
      {
        id: schId,
        name: 'Working Hours',
        timezone: tz,
        isDefault: true,
        weeklyHours: { ...DEFAULT_WEEKLY_HOURS },
        dateOverrides: [],
        createdAt: nowIso,
      },
    ],
    eventTypes: [
      {
        id: 'evt_15',
        slug: '15min',
        title: '15 Min Quick Chat',
        description: 'A quick intro call to say hello and align on next steps.',
        durationMinutes: 15,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 5,
        minimumNoticeMinutes: 60,
        maxFutureDays: 60,
        slotIntervalMinutes: 15,
        locationType: 'jitsi',
        locationValue: '',
        requiresConfirmation: false,
        color: '#2563eb',
        hidden: false,
        scheduleId: schId,
        customQuestions: [],
        createdAt: nowIso,
      },
      {
        id: 'evt_30',
        slug: '30min',
        title: '30 Min Meeting',
        description: 'Standard 30-minute video session for demos, feedback, or project syncs.',
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 5,
        minimumNoticeMinutes: 60,
        maxFutureDays: 60,
        slotIntervalMinutes: 30,
        locationType: 'jitsi',
        locationValue: '',
        requiresConfirmation: false,
        color: '#111827',
        hidden: false,
        scheduleId: schId,
        customQuestions: [
          {
            id: 'q_topic',
            label: 'What would you like to discuss?',
            type: 'textarea',
            required: false,
            placeholder: 'Share any links or context ahead of our call...',
          },
        ],
        createdAt: nowIso,
      },
      {
        id: 'evt_60',
        slug: '60min',
        title: '60 Min Architecture Review',
        description: 'Deep-dive working session with confirmation before locking the calendar.',
        durationMinutes: 60,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 10,
        minimumNoticeMinutes: 120,
        maxFutureDays: 45,
        slotIntervalMinutes: 30,
        locationType: 'jitsi',
        locationValue: '',
        requiresConfirmation: true,
        color: '#059669',
        hidden: false,
        scheduleId: schId,
        customQuestions: [],
        createdAt: nowIso,
      },
    ],
    bookings: [
      {
        id: 'b_demo1',
        uid: 'bk_demo1001',
        eventTypeId: 'evt_30',
        eventTypeTitle: '30 Min Meeting',
        eventTypeSlug: '30min',
        title: '30 Min Meeting between Alex Morgan and Jordan Lee',
        startUtc: sampleStart.toISOString(),
        endUtc: sampleEnd.toISOString(),
        durationMinutes: 30,
        status: 'confirmed',
        attendeeName: 'Jordan Lee',
        attendeeEmail: 'jordan@studio.example',
        attendeeTimezone: tz,
        attendeeNotes: 'Looking forward to walking through our Cloudflare Workers migration.',
        customAnswers: {},
        locationType: 'jitsi',
        locationDisplay: LOCATION_LABELS.jitsi,
        meetingUrl: 'https://meet.jit.si/edgecal-bk_demo1001',
        cancelToken: 'demo_cancel_token',
        rescheduleToken: 'demo_reschedule_token',
        cancellationReason: '',
        reminder24hSentAt: null,
        reminder1hSentAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    webhooks: [],
    integrations: [],
    blockedSlots: [],
    activity: [
      {
        id: 'act_init',
        kind: 'system',
        message: 'Running in Local Static Preview mode. Deploy to Cloudflare Workers to activate live SQLite Durable Objects & Alarms.',
        createdAt: nowIso,
      },
    ],
  };
}

function loadState(): LocalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as LocalState;
    }
  } catch {
    // ignore
  }
  const initial = createInitialDemoState();
  saveState(initial);
  return initial;
}

function saveState(state: LocalState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function pushActivity(state: LocalState, kind: ActivityLogEntry['kind'], message: string) {
  state.activity = [
    { id: uid('act'), kind, message, createdAt: new Date().toISOString() },
    ...state.activity,
  ].slice(0, 40);
}

export const localStore = {
  resetToFreshSetup() {
    const s = createInitialDemoState();
    s.setupCompleted = false;
    s.loggedIn = false;
    s.bookings = [];
    saveState(s);
  },

  getSetupStatus(): SetupStatusResponse {
    const s = loadState();
    return {
      setupCompleted: s.setupCompleted,
      allowSignups: false,
      appName: 'EdgeCal',
      runtime: 'local-preview',
      defaultUsername: s.setupCompleted ? s.profile.username : null,
    };
  },

  setup(body: {
    username: string;
    email: string;
    name: string;
    password: string;
    timezone?: string;
    weeklyHours?: WeeklyHours;
    createStarterEvents?: boolean;
  }) {
    const s = createInitialDemoState();
    const tz = safeTimeZone(body.timezone || getLocalTimeZone());
    s.setupCompleted = true;
    s.loggedIn = true;
    s.password = body.password;
    s.profile = {
      ...s.profile,
      username: slugify(body.username) || 'host',
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      timezone: tz,
    };
    s.schedules[0].timezone = tz;
    if (body.weeklyHours) s.schedules[0].weeklyHours = body.weeklyHours;
    if (body.createStarterEvents === false) s.eventTypes = [];
    s.bookings = [];
    pushActivity(s, 'system', `Completed first-run setup for @${s.profile.username}.`);
    saveState(s);
    return { user: s.profile };
  },

  login(identifier: string, password: string) {
    const s = loadState();
    const idNorm = identifier.trim().toLowerCase();
    if (
      (idNorm === s.profile.email.toLowerCase() || idNorm === s.profile.username.toLowerCase()) &&
      (password === s.password || password === 'demo')
    ) {
      s.loggedIn = true;
      saveState(s);
      return { user: s.profile };
    }
    throw new Error('Invalid credentials. In Local Preview mode, use your username/email and password "demo".');
  },

  logout() {
    const s = loadState();
    s.loggedIn = false;
    saveState(s);
  },

  me() {
    const s = loadState();
    return { user: s.loggedIn ? s.profile : null };
  },

  getProfile() {
    return { profile: loadState().profile };
  },

  updateProfile(patch: Partial<HostProfile> & { newPassword?: string }) {
    const s = loadState();
    s.profile = {
      ...s.profile,
      ...patch,
      username: patch.username ? slugify(patch.username) || s.profile.username : s.profile.username,
    };
    if (patch.newPassword) s.password = patch.newPassword;
    saveState(s);
    return { profile: s.profile };
  },

  getPublicHost(username: string): PublicHostBundle {
    const s = loadState();
    if (username.toLowerCase() !== s.profile.username.toLowerCase()) {
      throw new Error(`Host "@${username}" not found.`);
    }
    const { email: _e, ...pub } = s.profile;
    return { profile: pub, eventTypes: s.eventTypes.filter((e) => !e.hidden) };
  },

  getPublicSlots(
    username: string,
    slug: string,
    startDate: string,
    endDate: string,
    timeZone: string,
    excludeBookingId?: string,
  ): { slots: Record<string, TimeSlot[]>; eventType: EventType; scheduleTimezone: string } {
    const s = loadState();
    if (username.toLowerCase() !== s.profile.username.toLowerCase()) {
      throw new Error('Host not found.');
    }
    const et = s.eventTypes.find((e) => e.slug === slug && !e.hidden);
    if (!et) throw new Error('Event type not found.');
    const sch = s.schedules.find((x) => x.id === et.scheduleId) ?? s.schedules[0];
    const slots = computeAvailableSlotsByDate({
      eventType: et,
      schedule: sch,
      bookings: s.bookings,
      blockedIntervals: s.blockedSlots,
      startDateYmd: startDate,
      endDateYmd: endDate,
      viewerTimeZone: timeZone,
      excludeBookingId,
    });
    return { slots, eventType: et, scheduleTimezone: sch.timezone };
  },

  createBooking(
    username: string,
    body: {
      eventTypeSlug: string;
      startUtc: string;
      attendeeName: string;
      attendeeEmail: string;
      attendeeTimezone: string;
      attendeeNotes?: string;
      customAnswers?: Record<string, string>;
    },
  ): { booking: Booking } {
    const s = loadState();
    if (username.toLowerCase() !== s.profile.username.toLowerCase()) {
      throw new Error('Host not found.');
    }
    const et = s.eventTypes.find((e) => e.slug === body.eventTypeSlug);
    if (!et) throw new Error('Event type not found.');
    const sch = s.schedules.find((x) => x.id === et.scheduleId) ?? s.schedules[0];
    const check = isSlotBookable({
      startUtc: body.startUtc,
      eventType: et,
      schedule: sch,
      bookings: s.bookings,
      blockedIntervals: s.blockedSlots,
    });
    if (!check.ok) throw new Error(check.reason);

    const bUid = uid('bk');
    const nowIso = new Date().toISOString();
    const booking: Booking = {
      id: uid('b'),
      uid: bUid,
      eventTypeId: et.id,
      eventTypeTitle: et.title,
      eventTypeSlug: et.slug,
      title: `${et.title} between ${s.profile.name} and ${body.attendeeName.trim()}`,
      startUtc: new Date(Date.parse(body.startUtc)).toISOString(),
      endUtc: check.endUtc,
      durationMinutes: et.durationMinutes,
      status: et.requiresConfirmation ? 'pending' : 'confirmed',
      attendeeName: body.attendeeName.trim(),
      attendeeEmail: body.attendeeEmail.trim().toLowerCase(),
      attendeeTimezone: safeTimeZone(body.attendeeTimezone),
      attendeeNotes: (body.attendeeNotes || '').trim(),
      customAnswers: body.customAnswers ?? {},
      locationType: et.locationType,
      locationDisplay: et.locationValue || LOCATION_LABELS[et.locationType],
      meetingUrl:
        et.locationType === 'jitsi' || et.locationType === 'daily'
          ? `https://meet.jit.si/edgecal-${bUid}`
          : et.locationValue || '',
      cancelToken: uid('ct'),
      rescheduleToken: uid('rt'),
      cancellationReason: '',
      reminder24hSentAt: null,
      reminder1hSentAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    s.bookings.push(booking);
    pushActivity(s, 'booking', `Created ${booking.status} booking "${et.title}" for ${booking.attendeeName}.`);
    saveState(s);
    return { booking };
  },

  getPublicBooking(
    bookingUid: string,
    tokens?: { cancelToken?: string; rescheduleToken?: string },
  ): PublicBookingResponse {
    const s = loadState();
    const booking = s.bookings.find((b) => b.uid === bookingUid);
    if (!booking) throw new Error('Booking not found.');
    const canCancel =
      s.loggedIn || (Boolean(tokens?.cancelToken) && tokens?.cancelToken === booking.cancelToken);
    const canReschedule =
      s.loggedIn ||
      (Boolean(tokens?.rescheduleToken) && tokens?.rescheduleToken === booking.rescheduleToken);
    const authorized = canCancel || canReschedule;
    const { cancelToken: _ct, rescheduleToken: _rt, ...pub } = booking;
    const publicBooking: PublicBooking = authorized
      ? pub
      : { ...pub, attendeeEmail: '', attendeeNotes: '', customAnswers: {} };
    const { email: _e, ...host } = s.profile;
    return { booking: publicBooking, host, canCancel, canReschedule };
  },

  cancelPublicBooking(bookingUid: string, token: string, reason: string): { booking: PublicBooking } {
    const s = loadState();
    const b = s.bookings.find((x) => x.uid === bookingUid);
    if (!b) throw new Error('Booking not found.');
    if (!s.loggedIn && (!token || token !== b.cancelToken)) {
      throw new Error('Invalid cancellation token.');
    }
    b.status = 'cancelled';
    b.cancellationReason = reason;
    b.updatedAt = new Date().toISOString();
    pushActivity(s, 'booking', `Cancelled booking ${b.uid}.`);
    saveState(s);
    const { cancelToken: _ct, rescheduleToken: _rt, ...pub } = b;
    return { booking: pub };
  },

  reschedulePublicBooking(
    bookingUid: string,
    token: string,
    newStartUtc: string,
    attendeeTimezone?: string,
  ): { booking: PublicBooking } {
    const s = loadState();
    const b = s.bookings.find((x) => x.uid === bookingUid);
    if (!b) throw new Error('Booking not found.');
    if (!s.loggedIn && (!token || token !== b.rescheduleToken)) {
      throw new Error('Invalid reschedule token.');
    }
    const et = s.eventTypes.find((e) => e.id === b.eventTypeId || e.slug === b.eventTypeSlug);
    if (!et) throw new Error('Event type not found.');
    const sch = s.schedules.find((x) => x.id === et.scheduleId) ?? s.schedules[0];
    const check = isSlotBookable({
      startUtc: newStartUtc,
      eventType: et,
      schedule: sch,
      bookings: s.bookings,
      blockedIntervals: s.blockedSlots,
      excludeBookingId: b.id,
    });
    if (!check.ok) throw new Error(check.reason);
    b.startUtc = new Date(Date.parse(newStartUtc)).toISOString();
    b.endUtc = check.endUtc;
    if (attendeeTimezone) b.attendeeTimezone = safeTimeZone(attendeeTimezone);
    b.updatedAt = new Date().toISOString();
    pushActivity(s, 'booking', `Rescheduled booking ${b.uid}.`);
    saveState(s);
    const { cancelToken: _ct, rescheduleToken: _rt, ...pub } = b;
    return { booking: pub };
  },

  downloadBookingIcs(bookingUid: string) {
    const s = loadState();
    const b = s.bookings.find((x) => x.uid === bookingUid);
    if (!b) return;
    const ics = generateBookingIcs(b, s.profile, window.location.origin);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `booking-${b.uid}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  listEventTypes() {
    return { eventTypes: loadState().eventTypes };
  },

  createEventType(body: Partial<EventType>) {
    const s = loadState();
    const title = (body.title || '').trim();
    if (!title) throw new Error('Title is required.');
    const baseSlug = slugify(body.slug || title) || uid('evt');
    let slug = baseSlug;
    let i = 2;
    while (s.eventTypes.some((e) => e.slug === slug)) slug = `${baseSlug}-${i++}`;
    const et: EventType = {
      id: uid('evt'),
      slug,
      title,
      description: body.description ?? '',
      durationMinutes: Number(body.durationMinutes) || 30,
      bufferBeforeMinutes: Number(body.bufferBeforeMinutes) || 0,
      bufferAfterMinutes: Number(body.bufferAfterMinutes) || 0,
      minimumNoticeMinutes: body.minimumNoticeMinutes ?? 60,
      maxFutureDays: Number(body.maxFutureDays) || 60,
      slotIntervalMinutes: Number(body.slotIntervalMinutes) || Number(body.durationMinutes) || 30,
      locationType: body.locationType ?? 'jitsi',
      locationValue: body.locationValue ?? '',
      requiresConfirmation: Boolean(body.requiresConfirmation),
      color: body.color ?? '#111827',
      hidden: Boolean(body.hidden),
      scheduleId: body.scheduleId || s.schedules[0].id,
      customQuestions: body.customQuestions ?? [],
      createdAt: new Date().toISOString(),
    };
    s.eventTypes.push(et);
    saveState(s);
    return { eventType: et };
  },

  updateEventType(id: string, body: Partial<EventType>) {
    const s = loadState();
    const idx = s.eventTypes.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error('Event type not found.');
    const nextSlug = body.slug ? slugify(body.slug) : s.eventTypes[idx].slug;
    if (s.eventTypes.some((e) => e.id !== id && e.slug === nextSlug)) {
      throw new Error('Another event type already uses that URL slug.');
    }
    s.eventTypes[idx] = { ...s.eventTypes[idx], ...body, slug: nextSlug };
    saveState(s);
    return { eventType: s.eventTypes[idx] };
  },

  deleteEventType(id: string) {
    const s = loadState();
    s.eventTypes = s.eventTypes.filter((e) => e.id !== id);
    saveState(s);
  },

  listSchedules() {
    return { schedules: loadState().schedules };
  },

  createSchedule(body: { name: string; timezone?: string; isDefault?: boolean; weeklyHours?: WeeklyHours }) {
    const s = loadState();
    if (body.isDefault) s.schedules.forEach((sc) => (sc.isDefault = false));
    const sch: AvailabilitySchedule = {
      id: uid('sch'),
      name: body.name.trim() || 'New Schedule',
      timezone: safeTimeZone(body.timezone || s.profile.timezone),
      isDefault: Boolean(body.isDefault),
      weeklyHours: body.weeklyHours ?? { ...DEFAULT_WEEKLY_HOURS },
      dateOverrides: [],
      createdAt: new Date().toISOString(),
    };
    s.schedules.push(sch);
    saveState(s);
    return { schedule: sch };
  },

  updateSchedule(id: string, body: Partial<AvailabilitySchedule>) {
    const s = loadState();
    const idx = s.schedules.findIndex((sc) => sc.id === id);
    if (idx === -1) throw new Error('Schedule not found.');
    if (body.isDefault) s.schedules.forEach((sc) => (sc.isDefault = false));
    s.schedules[idx] = { ...s.schedules[idx], ...body };
    saveState(s);
    return { schedule: s.schedules[idx] };
  },

  deleteSchedule(id: string) {
    const s = loadState();
    if (s.schedules.length <= 1) throw new Error('Keep at least one schedule.');
    s.schedules = s.schedules.filter((sc) => sc.id !== id);
    if (!s.schedules.some((sc) => sc.isDefault)) s.schedules[0].isDefault = true;
    saveState(s);
  },

  upsertDateOverride(
    scheduleId: string,
    body: { dateYmd: string; unavailable: boolean; ranges?: TimeRange[]; label?: string },
  ) {
    const s = loadState();
    const sch = s.schedules.find((sc) => sc.id === scheduleId);
    if (!sch) throw new Error('Schedule not found.');
    sch.dateOverrides = sch.dateOverrides.filter((o) => o.dateYmd !== body.dateYmd);
    sch.dateOverrides.push({
      id: uid('ovr'),
      scheduleId,
      dateYmd: body.dateYmd,
      unavailable: body.unavailable,
      ranges: body.unavailable ? [] : body.ranges ?? [],
      label: body.label ?? '',
    });
    sch.dateOverrides.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd));
    saveState(s);
    return { schedule: sch };
  },

  deleteDateOverride(overrideId: string) {
    const s = loadState();
    for (const sch of s.schedules) {
      sch.dateOverrides = sch.dateOverrides.filter((o) => o.id !== overrideId);
    }
    saveState(s);
  },

  listBookings() {
    return { bookings: loadState().bookings };
  },

  confirmBooking(id: string) {
    const s = loadState();
    const b = s.bookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found.');
    b.status = 'confirmed';
    b.updatedAt = new Date().toISOString();
    pushActivity(s, 'booking', `Confirmed booking ${b.uid} (${b.attendeeName}).`);
    saveState(s);
    return { booking: b };
  },

  cancelHostBooking(id: string, reason?: string) {
    const s = loadState();
    const b = s.bookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found.');
    b.status = 'cancelled';
    b.cancellationReason = reason ?? '';
    b.updatedAt = new Date().toISOString();
    pushActivity(s, 'booking', `Host cancelled booking ${b.uid}.`);
    saveState(s);
    return { booking: b };
  },

  listWebhooks() {
    return { webhooks: loadState().webhooks };
  },

  createWebhook(body: { url: string; events?: WebhookEventType[]; secret?: string }) {
    const s = loadState();
    const wh: WebhookConfig = {
      id: uid('wh'),
      url: body.url.trim(),
      secret: body.secret?.trim() || `whsec_${Math.random().toString(36).slice(2)}`,
      events: body.events?.length ? body.events : ['BOOKING_CREATED', 'BOOKING_CANCELLED'],
      active: true,
      lastStatus: null,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    };
    s.webhooks.unshift(wh);
    saveState(s);
    return { webhook: wh };
  },

  updateWebhook(id: string, body: Partial<WebhookConfig>) {
    const s = loadState();
    const idx = s.webhooks.findIndex((w) => w.id === id);
    if (idx !== -1) {
      s.webhooks[idx] = { ...s.webhooks[idx], ...body };
      saveState(s);
    }
  },

  deleteWebhook(id: string) {
    const s = loadState();
    s.webhooks = s.webhooks.filter((w) => w.id !== id);
    saveState(s);
  },

  testWebhook(id: string) {
    const s = loadState();
    const wh = s.webhooks.find((w) => w.id === id);
    if (wh) {
      wh.lastStatus = 200;
      wh.lastTriggeredAt = new Date().toISOString();
      pushActivity(s, 'webhook', `Simulated webhook delivery to ${wh.url} (deploy to Workers for live signed HTTP POST).`);
      saveState(s);
    }
    return { ok: true, status: 200 };
  },

  listIntegrations() {
    const s = loadState();
    return { integrations: s.integrations, blockedSlotsCount: s.blockedSlots.length };
  },

  saveIntegration(provider: IntegrationProvider, enabled: boolean, config: Record<string, string>) {
    const s = loadState();
    const idx = s.integrations.findIndex((i) => i.provider === provider);
    const rec: IntegrationConfig = {
      provider,
      enabled,
      config,
      updatedAt: new Date().toISOString(),
    };
    if (idx === -1) s.integrations.push(rec);
    else s.integrations[idx] = rec;
    pushActivity(s, 'system', `Saved ${provider} integration (${enabled ? 'enabled' : 'disabled'}).`);
    saveState(s);
    return { ok: true };
  },

  syncIcsFeed(): { ok: boolean; count: number; error?: string } {
    const s = loadState();
    pushActivity(s, 'sync', 'External ICS sync runs server-side inside the Cloudflare Durable Object Alarm on deployment.');
    saveState(s);
    return { ok: true, count: s.blockedSlots.length };
  },

  getStatus(): DOStatusInfo {
    const s = loadState();
    const now = Date.now();
    const upcoming = s.bookings.filter((b) => b.status !== 'cancelled' && Date.parse(b.endUtc) > now);
    const nextReminder = upcoming
      .map((b) => Date.parse(b.startUtc) - 3600_000)
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];

    return {
      runtime: 'local-preview',
      durableObjectClass: 'HostSchedulerDO (Local Preview Simulator)',
      hostId: s.profile.id,
      nextAlarmUtc: nextReminder ? new Date(nextReminder).toISOString() : null,
      counts: {
        eventTypes: s.eventTypes.length,
        schedules: s.schedules.length,
        bookingsTotal: s.bookings.length,
        bookingsUpcoming: upcoming.length,
        webhooks: s.webhooks.length,
        blockedSlots: s.blockedSlots.length,
      },
      recentActivity: s.activity,
    };
  },

  exportBackup() {
    const s = loadState();
    return {
      exportedAt: new Date().toISOString(),
      profile: s.profile,
      schedules: s.schedules,
      eventTypes: s.eventTypes,
      bookings: s.bookings,
      webhooks: s.webhooks,
      integrations: s.integrations,
    };
  },
};
