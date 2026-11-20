import React, { useState } from 'react';
import { ArrowRight, Calendar, Check, Cloud, ShieldCheck, Sparkles } from 'lucide-react';
import { DAY_SHORT_NAMES, DEFAULT_WEEKLY_HOURS, type WeeklyHours } from '../../shared/types';
import { getLocalTimeZone } from '../../shared/timezones';
import { slugify } from '../../shared/scheduling';
import { TimeZoneSelect } from '../components/TimeZoneSelect';
import { api } from '../lib/api';

interface SetupPageProps {
  mode: 'setup' | 'login';
  runtime: 'worker' | 'local';
  defaultUsername: string | null;
  onAuthenticated: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export const SetupPage: React.FC<SetupPageProps> = ({
  mode,
  runtime,
  defaultUsername,
  onAuthenticated,
  onNavigate,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(getLocalTimeZone());
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours>({ ...DEFAULT_WEEKLY_HOURS });
  const [createStarterEvents, setCreateStarterEvents] = useState(true);

  const [loginId, setLoginId] = useState(defaultUsername || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(loginId, loginPassword);
      await onAuthenticated();
      onNavigate('/event-types');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await api.setup({
        name,
        username: slugify(username || name),
        email,
        password,
        timezone,
        weeklyHours,
        createStarterEvents,
      });
      await onAuthenticated();
      onNavigate('/event-types');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (day: number) => {
    setWeeklyHours((prev) => ({
      ...prev,
      [day]: prev[day]?.length ? [] : [{ start: '09:00', end: '17:00' }],
    }));
  };

  if (mode === 'login') {
    return (
      <div className="min-h-screen flex flex-col bg-[#fafafa]">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">EdgeCal</span>
            <span className="text-xs text-gray-500">Cloudflare Workers</span>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white font-bold text-lg shadow-sm">
                EC
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Sign in to EdgeCal</h1>
              <p className="text-sm text-gray-500">
                Self-hosted scheduling on Cloudflare Workers &amp; Durable Objects
              </p>
            </div>

            <form
              onSubmit={handleLogin}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4"
            >
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Email or Username
                </label>
                <input
                  type="text"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="you@domain.com or username"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>

              {runtime === 'local' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                  <strong>Local Preview tip:</strong> Sign in with username <code className="font-mono">alex</code> and password <code className="font-mono">demo</code>.
                </div>
              )}

              {defaultUsername && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => onNavigate(`/${defaultUsername}`)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
                  >
                    View public booking page (/{defaultUsername})
                  </button>
                </div>
              )}
            </form>
          </div>
        </main>
        <footer className="border-t border-gray-200 bg-white px-4 py-4 text-center text-xs text-gray-500">
          EdgeCal · Native Cloudflare Workers &amp; Durable Objects
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-800">
            <Cloud className="h-3.5 w-3.5" />
            Cloudflare Workers + SQLite Durable Objects
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Welcome to EdgeCal
          </h1>
          <p className="text-sm text-gray-600">
            Set up your self-hosted scheduling workspace in 30 seconds — no external database required.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-3 text-xs font-medium">
          {[
            { n: 1, label: 'Admin Account' },
            { n: 2, label: 'Working Hours' },
            { n: 3, label: 'Starter Events' },
          ].map((item) => (
            <div key={item.n} className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  step > item.n
                    ? 'bg-emerald-600 text-white'
                    : step === item.n
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {step > item.n ? <Check className="h-3.5 w-3.5" /> : item.n}
              </span>
              <span className={step === item.n ? 'text-gray-900' : 'text-gray-400'}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-xs space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!username) setUsername(slugify(e.target.value));
                  }}
                  placeholder="Alex Morgan"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Booking Link Username
                </label>
                <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden focus-within:border-gray-900">
                  <span className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-r border-gray-200">
                    {window.location.host}/
                  </span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(slugify(e.target.value))}
                    placeholder="alex"
                    className="flex-1 px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@example.com"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Default Timezone
                </label>
                <TimeZoneSelect value={timezone} onChange={setTimezone} />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!name.trim() || !email.includes('@') || password.length < 6) {
                    setError('Please enter your name, a valid email, and a password (6+ characters).');
                    return;
                  }
                  setError('');
                  setStep(2);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition"
              >
                Continue to Working Hours
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Your Weekly Availability</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Toggle the days you take bookings. You can add split hours and vacation overrides anytime.
                </p>
              </div>

              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                  const ranges = weeklyHours[day] || [];
                  const enabled = ranges.length > 0;
                  return (
                    <div
                      key={day}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3.5 py-2.5"
                    >
                      <label className="flex items-center gap-2.5 text-sm font-medium text-gray-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleDay(day)}
                          className="h-4 w-4 rounded border-gray-300 accent-gray-900"
                        />
                        <span>{DAY_SHORT_NAMES[day]}</span>
                      </label>

                      {enabled ? (
                        <div className="flex items-center gap-2 text-xs">
                          <input
                            type="time"
                            value={ranges[0].start}
                            onChange={(e) =>
                              setWeeklyHours((prev) => ({
                                ...prev,
                                [day]: [{ ...ranges[0], start: e.target.value }],
                              }))
                            }
                            className="rounded-lg border border-gray-300 px-2 py-1"
                          />
                          <span className="text-gray-400">–</span>
                          <input
                            type="time"
                            value={ranges[0].end}
                            onChange={(e) =>
                              setWeeklyHours((prev) => ({
                                ...prev,
                                [day]: [{ ...ranges[0], end: e.target.value }],
                              }))
                            }
                            className="rounded-lg border border-gray-300 px-2 py-1"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Unavailable</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Next Step
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Ready to launch</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Calendar sync, email notifications, and webhooks can be connected later in Apps &amp; Webhooks.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={createStarterEvents}
                  onChange={(e) => setCreateStarterEvents(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-gray-900"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    Create starter event types
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Adds 15 Min Quick Chat, 30 Min Meeting, and 60 Min Deep Dive so your booking page works right away.
                  </p>
                </div>
              </label>

              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2 text-xs text-gray-600">
                <div className="flex items-center gap-2 font-medium text-gray-900">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Dedicated SQLite Durable Object
                </div>
                <p>
                  Your bookings, schedules, and reminders will live inside a single-threaded Cloudflare Durable Object — preventing double-bookings atomically without Postgres or Redis.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSetupSubmit}
                  className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  <Calendar className="h-4 w-4" />
                  {loading ? 'Initializing Durable Object...' : 'Finish Setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
