import type {
  AvailabilitySchedule,
  Booking,
  DOStatusInfo,
  EventType,
  HostProfile,
  IntegrationConfig,
  IntegrationProvider,
  PublicBooking,
  PublicBookingResponse,
  PublicHostBundle,
  SetupStatusResponse,
  TimeRange,
  TimeSlot,
  WebhookConfig,
  WebhookEventType,
  WeeklyHours,
} from '../../shared/types';
import { localStore } from './localFallback';

let workerMode: 'unknown' | 'worker' | 'local' = 'unknown';

async function detectRuntime(): Promise<'worker' | 'local'> {
  if (workerMode !== 'unknown') return workerMode;
  try {
    const res = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        workerMode = 'worker';
        return 'worker';
      }
    }
  } catch {
    // Static hosting without Worker backend
  }
  workerMode = 'local';
  return 'local';
}

async function reqJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  async getRuntime(): Promise<'worker' | 'local'> {
    return detectRuntime();
  },

  async getSetupStatus(): Promise<SetupStatusResponse> {
    if ((await detectRuntime()) === 'local') return localStore.getSetupStatus();
    return reqJson<SetupStatusResponse>('/api/setup/status');
  },

  async setup(body: {
    username: string;
    email: string;
    name: string;
    password: string;
    timezone?: string;
    weeklyHours?: WeeklyHours;
    createStarterEvents?: boolean;
  }) {
    if ((await detectRuntime()) === 'local') return localStore.setup(body);
    return reqJson<{ user: HostProfile }>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async login(identifier: string, password: string) {
    if ((await detectRuntime()) === 'local') return localStore.login(identifier, password);
    return reqJson<{ user: HostProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
  },

  async logout() {
    if ((await detectRuntime()) === 'local') {
      localStore.logout();
      return;
    }
    await reqJson('/api/auth/logout', { method: 'POST' });
  },

  async me() {
    if ((await detectRuntime()) === 'local') return localStore.me();
    return reqJson<{ user: HostProfile | null }>('/api/auth/me');
  },

  async getProfile() {
    if ((await detectRuntime()) === 'local') return localStore.getProfile();
    return reqJson<{ profile: HostProfile }>('/api/dashboard/profile');
  },

  async updateProfile(patch: Partial<HostProfile> & { newPassword?: string }) {
    if ((await detectRuntime()) === 'local') return localStore.updateProfile(patch);
    return reqJson<{ profile: HostProfile }>('/api/dashboard/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  async getPublicHost(username: string): Promise<PublicHostBundle> {
    if ((await detectRuntime()) === 'local') return localStore.getPublicHost(username);
    return reqJson<PublicHostBundle>(`/api/public/${encodeURIComponent(username)}`);
  },

  async getPublicSlots(
    username: string,
    slug: string,
    startDate: string,
    endDate: string,
    timeZone: string,
    excludeBookingId?: string,
  ): Promise<{ slots: Record<string, TimeSlot[]>; eventType: EventType; scheduleTimezone: string }> {
    if ((await detectRuntime()) === 'local') {
      return localStore.getPublicSlots(username, slug, startDate, endDate, timeZone, excludeBookingId);
    }
    const qs = new URLSearchParams({ slug, startDate, endDate, timeZone });
    if (excludeBookingId) qs.set('excludeBookingId', excludeBookingId);
    return reqJson(`/api/public/${encodeURIComponent(username)}/slots?${qs.toString()}`);
  },

  async createPublicBooking(
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
  ): Promise<{ booking: Booking }> {
    if ((await detectRuntime()) === 'local') return localStore.createBooking(username, body);
    return reqJson(`/api/public/${encodeURIComponent(username)}/bookings`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getPublicBooking(
    uid: string,
    tokens?: { cancelToken?: string; rescheduleToken?: string },
  ): Promise<PublicBookingResponse> {
    if ((await detectRuntime()) === 'local') return localStore.getPublicBooking(uid, tokens);
    const qs = new URLSearchParams();
    if (tokens?.cancelToken) qs.set('cancelToken', tokens.cancelToken);
    if (tokens?.rescheduleToken) qs.set('rescheduleToken', tokens.rescheduleToken);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return reqJson<PublicBookingResponse>(
      `/api/bookings/public/${encodeURIComponent(uid)}${suffix}`,
    );
  },

  async cancelPublicBooking(
    uid: string,
    token: string,
    reason: string,
  ): Promise<{ booking: PublicBooking }> {
    if ((await detectRuntime()) === 'local') return localStore.cancelPublicBooking(uid, token, reason);
    return reqJson(`/api/bookings/public/${encodeURIComponent(uid)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ token, reason }),
    });
  },

  async reschedulePublicBooking(
    uid: string,
    token: string,
    newStartUtc: string,
    attendeeTimezone?: string,
  ): Promise<{ booking: PublicBooking }> {
    if ((await detectRuntime()) === 'local') {
      return localStore.reschedulePublicBooking(uid, token, newStartUtc, attendeeTimezone);
    }
    return reqJson(`/api/bookings/public/${encodeURIComponent(uid)}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ token, newStartUtc, attendeeTimezone }),
    });
  },

  async downloadBookingIcs(uid: string) {
    if ((await detectRuntime()) === 'local') {
      localStore.downloadBookingIcs(uid);
      return;
    }
    window.location.href = `/ics/${encodeURIComponent(uid)}.ics`;
  },

  async listEventTypes() {
    if ((await detectRuntime()) === 'local') return localStore.listEventTypes();
    return reqJson<{ eventTypes: EventType[] }>('/api/dashboard/event-types');
  },

  async createEventType(body: Partial<EventType>) {
    if ((await detectRuntime()) === 'local') return localStore.createEventType(body);
    return reqJson<{ eventType: EventType }>('/api/dashboard/event-types', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateEventType(id: string, body: Partial<EventType>) {
    if ((await detectRuntime()) === 'local') return localStore.updateEventType(id, body);
    return reqJson<{ eventType: EventType }>(`/api/dashboard/event-types/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async deleteEventType(id: string) {
    if ((await detectRuntime()) === 'local') {
      localStore.deleteEventType(id);
      return;
    }
    await reqJson(`/api/dashboard/event-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listSchedules() {
    if ((await detectRuntime()) === 'local') return localStore.listSchedules();
    return reqJson<{ schedules: AvailabilitySchedule[] }>('/api/dashboard/schedules');
  },

  async createSchedule(body: {
    name: string;
    timezone?: string;
    isDefault?: boolean;
    weeklyHours?: WeeklyHours;
  }) {
    if ((await detectRuntime()) === 'local') return localStore.createSchedule(body);
    return reqJson<{ schedule: AvailabilitySchedule }>('/api/dashboard/schedules', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateSchedule(id: string, body: Partial<AvailabilitySchedule>) {
    if ((await detectRuntime()) === 'local') return localStore.updateSchedule(id, body);
    return reqJson<{ schedule: AvailabilitySchedule }>(
      `/api/dashboard/schedules/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },

  async deleteSchedule(id: string) {
    if ((await detectRuntime()) === 'local') {
      localStore.deleteSchedule(id);
      return;
    }
    await reqJson(`/api/dashboard/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async upsertDateOverride(
    scheduleId: string,
    body: { dateYmd: string; unavailable: boolean; ranges?: TimeRange[]; label?: string },
  ) {
    if ((await detectRuntime()) === 'local') return localStore.upsertDateOverride(scheduleId, body);
    return reqJson<{ schedule: AvailabilitySchedule }>(
      `/api/dashboard/schedules/${encodeURIComponent(scheduleId)}/overrides`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  async deleteDateOverride(overrideId: string) {
    if ((await detectRuntime()) === 'local') {
      localStore.deleteDateOverride(overrideId);
      return;
    }
    await reqJson(`/api/dashboard/schedules/overrides/${encodeURIComponent(overrideId)}`, {
      method: 'DELETE',
    });
  },

  async listBookings() {
    if ((await detectRuntime()) === 'local') return localStore.listBookings();
    return reqJson<{ bookings: Booking[] }>('/api/dashboard/bookings');
  },

  async confirmBooking(id: string) {
    if ((await detectRuntime()) === 'local') return localStore.confirmBooking(id);
    return reqJson<{ booking: Booking }>(`/api/dashboard/bookings/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
    });
  },

  async cancelHostBooking(id: string, reason?: string) {
    if ((await detectRuntime()) === 'local') return localStore.cancelHostBooking(id, reason);
    return reqJson<{ booking: Booking }>(`/api/dashboard/bookings/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? '' }),
    });
  },

  async listWebhooks() {
    if ((await detectRuntime()) === 'local') return localStore.listWebhooks();
    return reqJson<{ webhooks: WebhookConfig[] }>('/api/dashboard/webhooks');
  },

  async createWebhook(body: { url: string; events?: WebhookEventType[]; secret?: string }) {
    if ((await detectRuntime()) === 'local') return localStore.createWebhook(body);
    return reqJson<{ webhook: WebhookConfig }>('/api/dashboard/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateWebhook(id: string, body: Partial<WebhookConfig>) {
    if ((await detectRuntime()) === 'local') {
      localStore.updateWebhook(id, body);
      return;
    }
    await reqJson(`/api/dashboard/webhooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async deleteWebhook(id: string) {
    if ((await detectRuntime()) === 'local') {
      localStore.deleteWebhook(id);
      return;
    }
    await reqJson(`/api/dashboard/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async testWebhook(id: string) {
    if ((await detectRuntime()) === 'local') return localStore.testWebhook(id);
    return reqJson<{ ok: boolean; status: number }>(
      `/api/dashboard/webhooks/${encodeURIComponent(id)}/test`,
      { method: 'POST' },
    );
  },

  async listIntegrations() {
    if ((await detectRuntime()) === 'local') return localStore.listIntegrations();
    return reqJson<{ integrations: IntegrationConfig[]; blockedSlotsCount: number }>(
      '/api/dashboard/integrations',
    );
  },

  async saveIntegration(
    provider: IntegrationProvider,
    enabled: boolean,
    config: Record<string, string>,
  ) {
    if ((await detectRuntime()) === 'local') {
      return localStore.saveIntegration(provider, enabled, config);
    }
    return reqJson<{ ok: boolean }>(`/api/dashboard/integrations/${encodeURIComponent(provider)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, config }),
    });
  },

  async syncIcsFeed() {
    if ((await detectRuntime()) === 'local') return localStore.syncIcsFeed();
    return reqJson<{ ok: boolean; count: number; error?: string }>(
      '/api/dashboard/integrations/ics_feed/sync',
      { method: 'POST' },
    );
  },

  async getDOStatus(): Promise<DOStatusInfo> {
    if ((await detectRuntime()) === 'local') return localStore.getStatus();
    return reqJson<DOStatusInfo>('/api/dashboard/status');
  },

  async exportBackup(): Promise<unknown> {
    if ((await detectRuntime()) === 'local') return localStore.exportBackup();
    return reqJson('/api/dashboard/export');
  },
};
