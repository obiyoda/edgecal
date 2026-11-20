import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  Cloud,
  ExternalLink,
  Link2,
  LogOut,
  Menu,
  Puzzle,
  Settings,
  X,
} from 'lucide-react';
import type { HostProfile } from '../../shared/types';

interface ShellProps {
  currentPath: string;
  navigate: (path: string) => void;
  profile: HostProfile;
  runtime: 'worker' | 'local';
  onLogout: () => void;
  pendingCount: number;
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  currentPath,
  navigate,
  profile,
  runtime,
  onLogout,
  pendingCount,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { path: '/event-types', label: 'Event Types', icon: Link2 },
    { path: '/bookings', label: 'Bookings', icon: Calendar, badge: pendingCount },
    { path: '/availability', label: 'Availability', icon: Clock },
    { path: '/apps', label: 'Apps & Webhooks', icon: Puzzle },
    { path: '/settings', label: 'Settings & DO Status', icon: Settings },
    { path: '/deploy', label: 'Cloudflare Deploy', icon: Cloud },
  ];

  const initials = profile.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#f9fafb] border-r border-gray-200">
      <div className="flex items-center justify-between px-4 py-4">
        <button
          type="button"
          onClick={() => {
            navigate('/event-types');
            setMobileOpen(false);
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white font-bold text-sm">
            EC
          </span>
          <div>
            <div className="text-sm font-semibold text-gray-900 leading-tight">EdgeCal</div>
            <div className="text-[11px] text-gray-500 leading-tight">Workers + Durable Objects</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-3 mb-2">
        <div
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
            runtime === 'worker'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              runtime === 'worker' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="truncate">
            {runtime === 'worker' ? 'Live Durable Object SQLite' : 'Local Static Preview'}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5 py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentPath === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-gray-900 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-200/70 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </span>
              {item.badge ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    active ? 'bg-white text-gray-900' : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 p-3 space-y-2">
        <button
          type="button"
          onClick={() => {
            navigate(`/${profile.username}`);
            setMobileOpen(false);
          }}
          className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          <span className="truncate">/{profile.username}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>

        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: profile.avatarColor || '#ea580c' }}
            >
              {initials || 'H'}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-gray-900">{profile.name}</div>
              <div className="truncate text-[11px] text-gray-500">{profile.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 transition"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#fafafa]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] h-full shadow-xl">{sidebarContent}</div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white/90 backdrop-blur px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-gray-700 hover:bg-gray-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-gray-900 lg:hidden">EdgeCal</span>
            <span className="hidden lg:inline text-xs text-gray-500">
              Self-hosted scheduling · <span className="font-mono text-gray-700">/{profile.username}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/deploy')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100 transition"
            >
              <Cloud className="h-3.5 w-3.5" /> Deploy to Workers
            </button>
            <button
              type="button"
              onClick={() => navigate(`/${profile.username}`)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Public Page
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>

        <footer className="border-t border-gray-200 bg-white px-4 sm:px-6 lg:px-8 py-4 text-xs text-gray-500">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>EdgeCal · Native Cloudflare Workers &amp; SQLite Durable Objects</span>
            <span>MIT Open-Source Self-Hosted Scheduling</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
