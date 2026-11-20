import React, { useEffect, useState } from 'react';
import {
  CalendarSync,
  Check,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Video,
  Webhook,
} from 'lucide-react';
import type {
  IntegrationConfig,
  IntegrationProvider,
  WebhookConfig,
  WebhookEventType,
} from '../../shared/types';
import { api } from '../lib/api';

const ALL_WEBHOOK_EVENTS: WebhookEventType[] = [
  'BOOKING_CREATED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
  'BOOKING_REMINDER',
];

export const AppsPage: React.FC = () => {
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [blockedCount, setBlockedCount] = useState(0);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [notice, setNotice] = useState('');

  // Form states for integrations
  const [icsUrl, setIcsUrl] = useState('');
  const [icsEnabled, setIcsEnabled] = useState(false);
  const [cfEmailFrom, setCfEmailFrom] = useState('');
  const [cfEmailName, setCfEmailName] = useState('EdgeCal');
  const [cfSendToGuests, setCfSendToGuests] = useState(true);
  const [cfEmailEnabled, setCfEmailEnabled] = useState(true);
  const [dailyKey, setDailyKey] = useState('');
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [zoomUrl, setZoomUrl] = useState('');
  const [zoomEnabled, setZoomEnabled] = useState(false);

  // New webhook state
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>([
    'BOOKING_CREATED',
    'BOOKING_CANCELLED',
    'BOOKING_RESCHEDULED',
  ]);

  const load = async () => {
    const [intRes, whRes] = await Promise.all([api.listIntegrations(), api.listWebhooks()]);
    setIntegrations(intRes.integrations);
    setBlockedCount(intRes.blockedSlotsCount);
    setWebhooks(whRes.webhooks);

    const byProv = new Map(intRes.integrations.map((i) => [i.provider, i]));
    const ics = byProv.get('ics_feed');
    setIcsEnabled(Boolean(ics?.enabled));
    setIcsUrl(ics?.config.feedUrl || '');

    const cfEmail = byProv.get('cloudflare_email');
    setCfEmailEnabled(cfEmail ? Boolean(cfEmail.enabled) : true);
    setCfEmailFrom(cfEmail?.config.fromEmail || '');
    setCfEmailName(cfEmail?.config.fromName || 'EdgeCal');
    setCfSendToGuests(cfEmail?.config.sendToGuests !== 'false');

    const daily = byProv.get('daily_video');
    setDailyEnabled(Boolean(daily?.enabled));
    setDailyKey(daily?.config.apiKey || '');

    const zoom = byProv.get('zoom_link');
    setZoomEnabled(Boolean(zoom?.enabled));
    setZoomUrl(zoom?.config.meetingUrl || '');
  };

  useEffect(() => {
    load();
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const saveInt = async (
    provider: IntegrationProvider,
    enabled: boolean,
    config: Record<string, string>,
    label: string,
  ) => {
    await api.saveIntegration(provider, enabled, config);
    await load();
    flash(`${label} saved.`);
  };

  const syncIcsNow = async () => {
    const res = await api.syncIcsFeed();
    await load();
    if (res.error) flash(`Sync error: ${res.error}`);
    else flash(`Synced ${res.count} busy interval(s) into Durable Object SQLite.`);
  };

  const addWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whUrl.trim()) return;
    await api.createWebhook({ url: whUrl.trim(), events: whEvents });
    setWhUrl('');
    await load();
    flash('Webhook created with HMAC-SHA256 signing secret.');
  };

  const toggleWhEvent = (ev: WebhookEventType) => {
    setWhEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Apps &amp; Webhooks
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect external calendars, email notifications, video rooms, and signed webhooks.
          </p>
        </div>
        {notice && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
            <Check className="h-3.5 w-3.5" /> {notice}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* External ICS Calendar Busy Sync */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <CalendarSync className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Calendar Conflict Check (ICS Feed)
                </h2>
                <p className="text-xs text-gray-500">
                  Sync Google, Apple iCloud, or Outlook private .ics URL every 30 min via DO Alarms.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={icsEnabled}
                onChange={(e) => setIcsEnabled(e.target.checked)}
                className="accent-gray-900 h-4 w-4"
              />
              Active
            </label>
          </div>

          <input
            type="url"
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">
              Currently blocking <strong>{blockedCount}</strong> external busy slot(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={syncIcsNow}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Sync Now
              </button>
              <button
                type="button"
                onClick={() =>
                  saveInt('ics_feed', icsEnabled, { feedUrl: icsUrl }, 'ICS Calendar Sync')
                }
                className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Native Cloudflare Email Sending */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Cloudflare Email Sending (Native Binding)
                </h2>
                <p className="text-xs text-gray-500">
                  Sends booking confirmations, .ics invites, and DO Alarm reminders via Workers <code className="font-mono">SEND_EMAIL</code> — no API key required.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={cfEmailEnabled}
                onChange={(e) => setCfEmailEnabled(e.target.checked)}
                className="accent-gray-900 h-4 w-4"
              />
              Active
            </label>
          </div>

          <div className="space-y-2">
            <input
              type="email"
              value={cfEmailFrom}
              onChange={(e) => setCfEmailFrom(e.target.value)}
              placeholder="Sender address on your Cloudflare domain (e.g. bookings@yourdomain.com)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono"
            />
            <input
              type="text"
              value={cfEmailName}
              onChange={(e) => setCfEmailName(e.target.value)}
              placeholder="Sender display name (e.g. EdgeCal)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-gray-600 pt-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cfSendToGuests}
                onChange={(e) => setCfSendToGuests(e.target.checked)}
                className="accent-gray-900"
              />
              Also email attendees (requires Cloudflare Email Sending enabled on your domain; uncheck for host-only alerts)
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                saveInt(
                  'cloudflare_email',
                  cfEmailEnabled,
                  {
                    fromEmail: cfEmailFrom,
                    fromName: cfEmailName,
                    sendToGuests: cfSendToGuests ? 'true' : 'false',
                  },
                  'Cloudflare Email Sending',
                )
              }
              className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Save
            </button>
          </div>
        </div>

        {/* Daily.co Video */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Daily.co Auto Video Rooms</h2>
                <p className="text-xs text-gray-500">
                  Creates a private Daily room per booking (Jitsi Meet works automatically with zero keys).
                </p>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={dailyEnabled}
                onChange={(e) => setDailyEnabled(e.target.checked)}
                className="accent-gray-900 h-4 w-4"
              />
              Active
            </label>
          </div>

          <input
            type="password"
            value={dailyKey}
            onChange={(e) => setDailyKey(e.target.value)}
            placeholder="Daily API key (or set DAILY_API_KEY via wrangler secret)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => saveInt('daily_video', dailyEnabled, { apiKey: dailyKey }, 'Daily.co Video')}
              className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Save
            </button>
          </div>
        </div>

        {/* Default Zoom / Personal Meeting Room */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Default Zoom Meeting Link</h2>
                <p className="text-xs text-gray-500">
                  Automatically attached to any event type whose location is set to Zoom Meeting.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={zoomEnabled}
                onChange={(e) => setZoomEnabled(e.target.checked)}
                className="accent-gray-900 h-4 w-4"
              />
              Active
            </label>
          </div>

          <input
            type="url"
            value={zoomUrl}
            onChange={(e) => setZoomUrl(e.target.value)}
            placeholder="https://us04web.zoom.us/j/1234567890"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                saveInt('zoom_link', zoomEnabled, { meetingUrl: zoomUrl }, 'Zoom Meeting Link')
              }
              className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Webhooks Section */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 space-y-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-800">
            <Webhook className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Webhooks (HMAC-SHA256 Signed)</h2>
            <p className="text-xs text-gray-500">
              Trigger Zapier, Make, n8n, Slack, or custom Cloudflare Workers whenever bookings happen or reminders fire.
            </p>
          </div>
        </div>

        <form onSubmit={addWebhook} className="space-y-3 rounded-xl bg-gray-50 p-4 border border-gray-100">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              required
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              placeholder="https://hooks.example.com/edgecal"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-mono"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add Webhook
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_WEBHOOK_EVENTS.map((ev) => (
              <label
                key={ev}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono cursor-pointer ${
                  whEvents.includes(ev)
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={whEvents.includes(ev)}
                  onChange={() => toggleWhEvent(ev)}
                  className="hidden"
                />
                {ev}
              </label>
            ))}
          </div>
        </form>

        {webhooks.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-2">
            No webhooks configured yet. {integrations.length ? '' : ''}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-mono font-medium text-gray-900 truncate">
                    {wh.url}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                    <span>Secret: <code className="font-mono">{wh.secret.slice(0, 14)}…</code></span>
                    <span>·</span>
                    <span>Events: {wh.events.join(', ')}</span>
                    {wh.lastStatus !== null && wh.lastStatus !== undefined && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-gray-700">
                          Last HTTP {wh.lastStatus || 'ERR'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await api.testWebhook(wh.id);
                      await load();
                      flash(`Webhook test returned HTTP ${res.status}.`);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Send className="h-3 w-3" /> Test
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.deleteWebhook(wh.id);
                      await load();
                    }}
                    className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
