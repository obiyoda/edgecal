import React, { useCallback, useEffect, useState } from 'react';
import type { HostProfile, SetupStatusResponse } from '../shared/types';
import { api } from './lib/api';
import { Shell } from './components/Shell';
import { SetupPage } from './pages/SetupPage';
import { EventTypesPage } from './pages/EventTypesPage';
import { BookingsPage } from './pages/BookingsPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { AppsPage } from './pages/AppsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeployGuidePage } from './pages/DeployGuidePage';
import { PublicBookingPage } from './pages/PublicBookingPage';
import { BookingManagePage } from './pages/BookingManagePage';

const DASHBOARD_PATHS = new Set([
  '/event-types',
  '/bookings',
  '/availability',
  '/apps',
  '/settings',
  '/deploy',
]);

export const App: React.FC = () => {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [runtime, setRuntime] = useState<'worker' | 'local'>('local');
  const [profile, setProfile] = useState<HostProfile | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [booting, setBooting] = useState(true);

  const navigate = useCallback((to: string) => {
    const [nextPath, nextSearch] = to.split('?');
    const targetUrl = nextSearch ? `${nextPath}?${nextSearch}` : nextPath;
    if (window.location.pathname + window.location.search !== targetUrl) {
      window.history.pushState({}, '', targetUrl);
    }
    setPathname(nextPath);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refreshPendingCount = useCallback(async () => {
    try {
      const { bookings } = await api.listBookings();
      const now = Date.now();
      setPendingCount(
        bookings.filter((b) => b.status === 'pending' && Date.parse(b.endUtc) >= now).length,
      );
    } catch {
      setPendingCount(0);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setBooting(true);
    try {
      const rt = await api.getRuntime();
      setRuntime(rt);
      const status = await api.getSetupStatus();
      setSetupStatus(status);

      if (status.setupCompleted) {
        const meRes = await api.me();
        if (meRes.user) {
          const profRes = await api.getProfile();
          setProfile(profRes.profile);
          await refreshPendingCount();
        } else {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    } finally {
      setBooting(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleLogout = async () => {
    await api.logout();
    setProfile(null);
    navigate('/login');
  };

  if (booting || !setupStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafafa] text-sm text-gray-500">
        Starting EdgeCal...
      </div>
    );
  }

  // First-run setup gate
  if (!setupStatus.setupCompleted) {
    return (
      <SetupPage
        mode="setup"
        runtime={runtime}
        defaultUsername={setupStatus.defaultUsername}
        onAuthenticated={bootstrap}
        onNavigate={navigate}
      />
    );
  }

  // Public booking management page: /booking/:uid
  if (pathname.startsWith('/booking/')) {
    const uid = decodeURIComponent(pathname.slice('/booking/'.length).replace(/\/$/, ''));
    return <BookingManagePage uid={uid} navigate={navigate} />;
  }

  // Login route
  if (pathname === '/login') {
    if (profile) {
      navigate('/event-types');
      return null;
    }
    return (
      <SetupPage
        mode="login"
        runtime={runtime}
        defaultUsername={setupStatus.defaultUsername}
        onAuthenticated={bootstrap}
        onNavigate={navigate}
      />
    );
  }

  // Root redirect
  if (pathname === '/' || pathname === '') {
    if (profile) {
      return (
        <Shell
          currentPath="/event-types"
          navigate={navigate}
          profile={profile}
          runtime={runtime}
          onLogout={handleLogout}
          pendingCount={pendingCount}
        >
          <EventTypesPage profile={profile} navigate={navigate} />
        </Shell>
      );
    }
    if (setupStatus.defaultUsername) {
      return (
        <PublicBookingPage
          username={setupStatus.defaultUsername}
          isOwnerLoggedIn={false}
          navigate={navigate}
        />
      );
    }
    return (
      <SetupPage
        mode="login"
        runtime={runtime}
        defaultUsername={setupStatus.defaultUsername}
        onAuthenticated={bootstrap}
        onNavigate={navigate}
      />
    );
  }

  // Dashboard routes
  if (DASHBOARD_PATHS.has(pathname)) {
    if (!profile) {
      return (
        <SetupPage
          mode="login"
          runtime={runtime}
          defaultUsername={setupStatus.defaultUsername}
          onAuthenticated={bootstrap}
          onNavigate={navigate}
        />
      );
    }

    return (
      <Shell
        currentPath={pathname}
        navigate={navigate}
        profile={profile}
        runtime={runtime}
        onLogout={handleLogout}
        pendingCount={pendingCount}
      >
        {pathname === '/event-types' && (
          <EventTypesPage profile={profile} navigate={navigate} />
        )}
        {pathname === '/bookings' && (
          <BookingsPage
            profile={profile}
            navigate={navigate}
            onBookingsChange={refreshPendingCount}
          />
        )}
        {pathname === '/availability' && <AvailabilityPage />}
        {pathname === '/apps' && <AppsPage />}
        {pathname === '/settings' && (
          <SettingsPage profile={profile} onProfileUpdated={setProfile} />
        )}
        {pathname === '/deploy' && <DeployGuidePage />}
      </Shell>
    );
  }

  // Public host routes: /:username or /:username/:slug
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 || segments.length === 2) {
    return (
      <PublicBookingPage
        username={decodeURIComponent(segments[0])}
        eventSlug={segments[1] ? decodeURIComponent(segments[1]) : undefined}
        isOwnerLoggedIn={Boolean(profile)}
        navigate={navigate}
      />
    );
  }

  // Fallback
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafafa] p-6">
      <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 text-center space-y-3">
        <h1 className="text-lg font-semibold text-gray-900">Page not found</h1>
        <button
          type="button"
          onClick={() => navigate(profile ? '/event-types' : '/')}
          className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white"
        >
          Return to EdgeCal
        </button>
      </div>
    </div>
  );
};
