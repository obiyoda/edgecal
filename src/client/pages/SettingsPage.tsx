import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Play,
  RefreshCw,
} from 'lucide-react';
import type { DOStatusInfo, HostProfile, TimeFormat } from '../../shared/types';
import { addDaysToYmd, slugify, utcMsToZonedParts } from '../../shared/scheduling';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { api } from '../lib/api';

interface SettingsPageProps {
  profile: HostProfile;
  onProfileUpdated: (p: HostProfile) => void;
}

const AVATAR_COLORS = ['#ea580c', '#111827', '#2563eb', '#059669', '#7c3aed', '#db2777'];

export const SettingsPage: React.FC<SettingsPageProps> = ({ profile, onProfileUpdated }) => {
  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username);
  const [email, setEmail] = useState(profile.email);
  const [bio, setBio] = useState(profile.bio);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(profile.timeFormat);
  const [avatarColor, setAvatarColor] = useState(profile.avatarColor || '#ea580c');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<DOStatusInfo | null>(null);
  const [copiedFeed, setCopiedFeed] = useState(false);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestSteps, setSelfTestSteps] = useState<{ label: string; ok: boolean; detail: string }[]>(
    [],
  );

  const runSelfTest = async () => {
    setSelfTestRunning(true);
    const steps: { label: string; ok: boolean; detail: string }[] = [];
    try {
      // 1. Verify public host & event types
      const pub = await api.getPublicHost(profile.username);
      if (pub.eventTypes.length === 0) {
        steps.push({ label: 'Event types available', ok: false, detail: 'Create at least one public event type first.' });
        setSelfTestSteps(steps);
        return;
      }
      const et = pub.eventTypes[0];
      steps.push({ label: 'Host profile & events', ok: true, detail: `Found /${profile.username}/${et.slug}` });

      // 2. Compute live slots over next 14 days
      const startYmd = utcMsToZonedParts(Date.now(), profile.timezone).ymd;
      const endYmd = addDaysToYmd(startYmd, 14);
      const slotsRes = await api.getPublicSlots(profile.username, et.slug, startYmd, endYmd, profile.timezone);
      const firstDate = Object.keys(slotsRes.slots).sort()[0];
      const slot = firstDate ? slotsRes.slots[firstDate]?.[0] : null;
      if (!slot) {
        steps.push({ label: 'Availability slot check', ok: false, detail: 'No open slots in the next 14 days.' });
        setSelfTestSteps(steps);
        return;
      }
      steps.push({ label: 'Slot availability engine', ok: true, detail: `${Object.keys(slotsRes.slots).length} open day(s) found` });

      // 3. Create a test booking
      const created = await api.createPublicBooking(profile.username, {
        eventTypeSlug: et.slug,
        startUtc: slot.startUtc,
        attendeeName: 'Self-Test Guest',
        attendeeEmail: 'selftest@example.com',
        attendeeTimezone: profile.timezone,
        attendeeNotes: 'Automated end-to-end verification booking',
      });
      steps.push({ label: 'Atomic booking creation', ok: true, detail: `Created ${created.booking.uid}` });

      // 4. Verify double-booking is rejected
      let blockedDouble = false;
      try {
        await api.createPublicBooking(profile.username, {
          eventTypeSlug: et.slug,
          startUtc: slot.startUtc,
          attendeeName: 'Duplicate Guest',
          attendeeEmail: 'dup@example.com',
          attendeeTimezone: profile.timezone,
        });
      } catch {
        blockedDouble = true;
      }
      steps.push({
        label: 'Double-booking protection',
        ok: blockedDouble,
        detail: blockedDouble ? 'Conflicting booking rejected' : 'Unexpectedly allowed conflict',
      });

      // 5. Cancel the test booking cleanly
      await api.cancelPublicBooking(created.booking.uid, created.booking.cancelToken, 'Self-test cleanup');
      steps.push({ label: 'Cancel & release slot', ok: true, detail: 'Cleaned up test booking' });

      await loadStatus();
    } catch (err) {
      steps.push({
        label: 'Self-test error',
        ok: false,
        detail: err instanceof Error ? err.message : 'Unexpected failure',
      });
    } finally {
      setSelfTestSteps(steps);
      setSelfTestRunning(false);
    }
  };

  const loadStatus = async () => {
    const s = await api.getDOStatus();
    setStatus(s);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await api.updateProfile({
        name,
        username: slugify(username),
        email,
        bio,
        timezone,
        timeFormat,
        avatarColor,
        ...(newPassword.length >= 6 ? { newPassword } : {}),
      });
      onProfileUpdated(res.profile);
      setNewPassword('');
      setMessage('Profile updated in Durable Object.');
      setTimeout(() => setMessage(''), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const downloadBackup = async () => {
    const data = await api.exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `edgecal-backup-${profile.username}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const feedUrl = `${window.location.origin}/api/public/${profile.username}/feed.ics`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
          Settings &amp; Durable Object Status
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Update your host profile, subscribe to your calendar feed, and inspect Durable Object storage &amp; alarms.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Profile Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 space-y-4 shadow-xs"
        >
          <h2 className="text-base font-semibold text-gray-900">Host Profile</h2>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> {message}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(slugify(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Public Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Default Timezone
              </label>
              <TimeZoneSelect value={timezone} onChange={setTimezone} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Time Format</label>
              <div className="flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
                {(['12h', '24h'] as TimeFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setTimeFormat(fmt)}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                      timeFormat === fmt
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {fmt === '12h' ? '12-hour (2:30 PM)' : '24-hour (14:30)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">Avatar accent:</span>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAvatarColor(c)}
                  className={`h-6 w-6 rounded-full ${
                    avatarColor === c ? 'ring-2 ring-offset-2 ring-gray-900' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              New Password (leave blank to keep current)
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>

        {/* Durable Object Inspector + Feed + Backup */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Database className="h-4 w-4 text-orange-600" />
                Durable Object Inspector
              </h2>
              <button
                type="button"
                onClick={loadStatus}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                title="Refresh status"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {status && (
              <>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Class</span>
                    <span className="font-mono font-medium text-gray-900">
                      {status.durableObjectClass}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Host Shard Key</span>
                    <span className="font-mono text-gray-800">{status.hostId}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 flex items-center gap-1">
                      <Bell className="h-3 w-3" /> Next DO Alarm
                    </span>
                    <span className="font-mono text-gray-800">
                      {status.nextAlarmUtc
                        ? new Date(status.nextAlarmUtc).toLocaleString()
                        : 'Idle (none queued)'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { label: 'Events', val: status.counts.eventTypes },
                    { label: 'Upcoming', val: status.counts.bookingsUpcoming },
                    { label: 'Total Bks', val: status.counts.bookingsTotal },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl bg-gray-50 border border-gray-100 p-2.5 text-center"
                    >
                      <div className="text-lg font-bold text-gray-900">{item.val}</div>
                      <div className="text-[11px] text-gray-500">{item.label}</div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 space-y-2">
                  <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-gray-400" />
                    Recent Durable Object Activity
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1.5 edge-scrollbar">
                    {status.recentActivity.map((act) => (
                      <div
                        key={act.id}
                        className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-700"
                      >
                        <span className="uppercase font-mono text-[10px] text-gray-400 mr-1.5">
                          [{act.kind}]
                        </span>
                        {act.message}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 shadow-xs">
            <h2 className="text-sm font-semibold text-gray-900">Subscribe Calendar Feed (.ics)</h2>
            <p className="text-xs text-gray-500">
              Subscribe in Apple Calendar, Google Calendar, or Outlook to view all EdgeCal bookings live.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={feedUrl}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-mono text-gray-700"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(feedUrl);
                  setCopiedFeed(true);
                  setTimeout(() => setCopiedFeed(false), 1800);
                }}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copiedFeed ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Live Scheduling Self-Test</h2>
                <p className="text-xs text-gray-500">
                  Verifies slots, atomic booking, double-booking rejection, and cleanup.
                </p>
              </div>
              <button
                type="button"
                disabled={selfTestRunning}
                onClick={runSelfTest}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                {selfTestRunning ? 'Testing...' : 'Run Test'}
              </button>
            </div>
            {selfTestSteps.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {selfTestSteps.map((st, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                      st.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'
                    }`}
                  >
                    <span className="font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {st.label}
                    </span>
                    <span className="text-[11px] opacity-80 truncate">{st.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 flex items-center justify-between gap-3 shadow-xs">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Export SQLite Backup</h2>
              <p className="text-xs text-gray-500">Download all schedules, event types, and bookings as JSON.</p>
            </div>
            <button
              type="button"
              onClick={downloadBackup}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 shrink-0"
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
