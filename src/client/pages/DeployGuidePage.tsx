import React, { useState } from 'react';
import { Bell, Check, Cloud, Copy, Database, Lock, Terminal, Zap } from 'lucide-react';

export const DeployGuidePage: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyCmd = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const steps = [
    {
      id: 'install',
      title: '1. Install dependencies',
      cmd: 'npm install',
      desc: 'Installs Vite, Hono, React, and Cloudflare Wrangler.',
    },
    {
      id: 'login',
      title: '2. Connect your Cloudflare account',
      cmd: 'npx wrangler login',
      desc: 'Opens your browser once to authorize deploying Workers & Durable Objects.',
    },
    {
      id: 'deploy',
      title: '3. Build & deploy in one command',
      cmd: 'npm run deploy',
      desc: 'Builds the frontend assets, registers DirectoryDO + HostSchedulerDO SQLite migrations, and deploys globally.',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-xs font-medium text-orange-800 mb-2">
          <Cloud className="h-3.5 w-3.5" />
          Native Cloudflare Workers Architecture
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
          Deploy to Cloudflare Workers
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Why Durable Objects + SQLite is an ideal fit for self-hosted scheduling — zero Postgres, zero Redis, zero Docker.
        </p>
      </div>

      {/* Why Durable Objects Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            icon: Database,
            title: 'Zero External Database (Embedded SQLite)',
            body: 'Each host gets a dedicated SQLite-backed HostSchedulerDO. All event types, schedules, overrides, and bookings stay colocated with sub-millisecond reads and zero connection pooling.',
          },
          {
            icon: Lock,
            title: 'Atomic Double-Booking Prevention',
            body: 'Because each host’s Durable Object processes requests sequentially inside storage.transactionSync(), two visitors clicking the same time slot can never double-book.',
          },
          {
            icon: Bell,
            title: 'Built-In Reminders via Durable Object Alarms',
            body: 'HostSchedulerDO.alarm() automatically triggers 24h & 1h meeting reminders, expires unconfirmed bookings, and refreshes external ICS calendar feeds — no external cron server.',
          },
          {
            icon: Zap,
            title: 'Single-Artifact Install (Workers Static Assets)',
            body: 'Frontend UI and API deploy together in one wrangler.jsonc file. Works on Cloudflare Workers Free & Paid plans with SQLite Durable Objects.',
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2 shadow-xs"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Icon className="h-4 w-4 text-orange-600 shrink-0" />
                {card.title}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{card.body}</p>
            </div>
          );
        })}
      </div>

      {/* 3-Step Deploy */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 space-y-4 shadow-xs">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Terminal className="h-4 w-4 text-gray-600" />
          Simple 3-Step Install
        </h2>

        <div className="space-y-3">
          {steps.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-900">{s.title}</div>
                <div className="text-xs text-gray-500">{s.desc}</div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-mono text-gray-100 shrink-0">
                <span>{s.cmd}</span>
                <button
                  type="button"
                  onClick={() => copyCmd(s.id, s.cmd)}
                  className="rounded p-1 hover:bg-white/10"
                  title="Copy command"
                >
                  {copied === s.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cloudflare Email & Optional Secrets */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 space-y-3 shadow-xs">
        <h2 className="text-sm font-semibold text-gray-900">
          Cloudflare Email Sending &amp; Optional Video Secret
        </h2>
        <p className="text-xs text-gray-500">
          Email confirmations, .ics calendar invites, and Durable Object reminders use Cloudflare’s built-in <code className="font-mono">SEND_EMAIL</code> binding with zero third-party email API keys. Enable Email Sending on your domain in the Cloudflare Dashboard, update <code className="font-mono">EMAIL_FROM</code> in <code className="font-mono">wrangler.jsonc</code> (or in Apps &amp; Webhooks), and deploy:
        </p>
        <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs font-mono text-gray-100">
{`# Optional: Auto-create private Daily.co video rooms per booking (Jitsi works with zero keys)
npx wrangler secret put DAILY_API_KEY

# Test locally with live SQLite Durable Objects before deploying
npm run build && npm run dev:worker

# Deploy to Cloudflare Workers with Durable Objects + Cloudflare Email binding
npm run deploy`}
        </pre>
      </div>
    </div>
  );
};
