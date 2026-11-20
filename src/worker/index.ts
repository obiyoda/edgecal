import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { DirectoryDO } from './directory-do';
import { HostSchedulerDO } from './scheduler-do';

export { DirectoryDO, HostSchedulerDO };

interface AuthUser {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
}

type AppEnv = { Bindings: Env; Variables: { user?: AuthUser } };

const SESSION_COOKIE = 'edgecal_session';

const app = new Hono<AppEnv>();

function getDirectoryStub(env: Env): DurableObjectStub {
  const id = env.DIRECTORY_DO.idFromName('global');
  return env.DIRECTORY_DO.get(id);
}

function getHostStub(env: Env, hostId: string): DurableObjectStub {
  const id = env.HOST_SCHEDULER_DO.idFromName(hostId);
  return env.HOST_SCHEDULER_DO.get(id);
}

async function doJson<T = Record<string, unknown>>(
  stub: DurableObjectStub,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const resp = await stub.fetch(`https://do.internal${path}`, init);
  const data = (await resp.json().catch(() => ({}))) as T;
  return { status: resp.status, data };
}

function getOrigin(c: Context<AppEnv>): string {
  return c.env.APP_URL || new URL(c.req.url).origin;
}

async function resolveSessionUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const dir = getDirectoryStub(c.env);
  const { data } = await doJson<{ user: AuthUser | null }>(dir, '/session/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return data.user ?? null;
}

function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const isHttps = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

// ---- Health & First-Run Setup ----

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    runtime: 'cloudflare-durable-object',
    appName: c.env.APP_NAME || 'EdgeCal',
  });
});

app.get('/api/setup/status', async (c) => {
  const dir = getDirectoryStub(c.env);
  const { data } = await doJson<{
    setupCompleted: boolean;
    defaultUsername: string | null;
  }>(dir, '/status');
  return c.json({
    setupCompleted: Boolean(data.setupCompleted),
    allowSignups: c.env.ALLOW_SIGNUPS === 'true',
    appName: c.env.APP_NAME || 'EdgeCal',
    runtime: 'cloudflare-durable-object',
    defaultUsername: data.defaultUsername ?? null,
  });
});

app.post('/api/setup', async (c) => {
  const body = (await c.req.json()) as {
    username: string;
    email: string;
    name: string;
    password: string;
    timezone?: string;
    weeklyHours?: Record<number, { start: string; end: string }[]>;
    createStarterEvents?: boolean;
  };

  const dir = getDirectoryStub(c.env);
  const res = await doJson<{ token?: string; user?: AuthUser; error?: string }>(dir, '/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status >= 400 || !res.data.user || !res.data.token) {
    return c.json({ error: res.data.error || 'Setup failed.' }, res.status as 400);
  }

  const hostStub = getHostStub(c.env, res.data.user.id);
  const origin = encodeURIComponent(getOrigin(c));
  await doJson(hostStub, `/init?origin=${origin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId: res.data.user.id,
      username: res.data.user.username,
      name: res.data.user.name,
      email: res.data.user.email,
      timezone: body.timezone,
      weeklyHours: body.weeklyHours,
      createStarterEvents: body.createStarterEvents ?? true,
    }),
  });

  setSessionCookie(c, res.data.token);
  return c.json({ user: res.data.user }, 201);
});

// ---- Auth ----

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  const dir = getDirectoryStub(c.env);
  const res = await doJson<{ token?: string; user?: AuthUser; error?: string }>(dir, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 400 || !res.data.token || !res.data.user) {
    return c.json({ error: res.data.error || 'Invalid credentials.' }, res.status as 401);
  }
  setSessionCookie(c, res.data.token);
  return c.json({ user: res.data.user });
});

app.post('/api/auth/signup', async (c) => {
  if (c.env.ALLOW_SIGNUPS !== 'true') {
    return c.json({ error: 'Public signups are disabled on this instance.' }, 403);
  }
  const body = (await c.req.json()) as {
    username: string;
    email: string;
    name: string;
    password: string;
    timezone?: string;
  };
  const dir = getDirectoryStub(c.env);
  const res = await doJson<{ token?: string; user?: AuthUser; error?: string }>(dir, '/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 400 || !res.data.token || !res.data.user) {
    return c.json({ error: res.data.error || 'Signup failed.' }, res.status as 400);
  }

  const hostStub = getHostStub(c.env, res.data.user.id);
  const origin = encodeURIComponent(getOrigin(c));
  await doJson(hostStub, `/init?origin=${origin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostId: res.data.user.id,
      username: res.data.user.username,
      name: res.data.user.name,
      email: res.data.user.email,
      timezone: body.timezone,
      createStarterEvents: true,
    }),
  });

  setSessionCookie(c, res.data.token);
  return c.json({ user: res.data.user }, 201);
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const dir = getDirectoryStub(c.env);
    await doJson(dir, '/session/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const user = await resolveSessionUser(c);
  return c.json({ user });
});

// ---- Public Host & Booking Endpoints ----

app.get('/api/public/:username', async (c) => {
  const username = c.req.param('username');
  const dir = getDirectoryStub(c.env);
  const resolved = await doJson<{ userId?: string; error?: string }>(
    dir,
    `/resolve/username/${encodeURIComponent(username)}`,
  );
  if (resolved.status >= 400 || !resolved.data.userId) {
    return c.json({ error: 'Host not found.' }, 404);
  }

  const hostStub = getHostStub(c.env, resolved.data.userId);
  const pub = await doJson(hostStub, '/public');
  return c.json(pub.data, pub.status as 200);
});

app.get('/api/public/:username/slots', async (c) => {
  const username = c.req.param('username');
  const dir = getDirectoryStub(c.env);
  const resolved = await doJson<{ userId?: string }>(
    dir,
    `/resolve/username/${encodeURIComponent(username)}`,
  );
  if (resolved.status >= 400 || !resolved.data.userId) {
    return c.json({ error: 'Host not found.' }, 404);
  }

  const qs = new URL(c.req.url).searchParams.toString();
  const hostStub = getHostStub(c.env, resolved.data.userId);
  const res = await doJson(hostStub, `/public/slots?${qs}`);
  return c.json(res.data, res.status as 200);
});

app.post('/api/public/:username/bookings', async (c) => {
  const username = c.req.param('username');
  const dir = getDirectoryStub(c.env);
  const resolved = await doJson<{ userId?: string }>(
    dir,
    `/resolve/username/${encodeURIComponent(username)}`,
  );
  if (resolved.status >= 400 || !resolved.data.userId) {
    return c.json({ error: 'Host not found.' }, 404);
  }

  const body = await c.req.json();
  const hostStub = getHostStub(c.env, resolved.data.userId);
  const origin = encodeURIComponent(getOrigin(c));
  const res = await doJson<{ booking?: { uid: string }; hostId?: string; error?: string }>(
    hostStub,
    `/public/bookings?origin=${origin}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (res.status < 300 && res.data.booking?.uid) {
    await doJson(dir, '/booking-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: res.data.booking.uid, hostId: resolved.data.userId }),
    });
  }

  return c.json(res.data, res.status as 201);
});

app.get('/api/public/:username/feed.ics', async (c) => {
  const username = c.req.param('username');
  const dir = getDirectoryStub(c.env);
  const resolved = await doJson<{ userId?: string }>(
    dir,
    `/resolve/username/${encodeURIComponent(username)}`,
  );
  if (resolved.status >= 400 || !resolved.data.userId) {
    return c.text('Not found', 404);
  }
  const hostStub = getHostStub(c.env, resolved.data.userId);
  const origin = encodeURIComponent(getOrigin(c));
  return hostStub.fetch(`https://do.internal/public/feed.ics?origin=${origin}`);
});

app.get('/api/bookings/public/:uid', async (c) => {
  const uid = c.req.param('uid');
  const dir = getDirectoryStub(c.env);
  const idx = await doJson<{ hostId?: string }>(dir, `/booking-index/${encodeURIComponent(uid)}`);
  if (idx.status >= 400 || !idx.data.hostId) {
    return c.json({ error: 'Booking not found.' }, 404);
  }
  const sessionUser = await resolveSessionUser(c);
  const asHost = sessionUser?.id === idx.data.hostId;
  const reqUrl = new URL(c.req.url);
  const qs = new URLSearchParams();
  const cancelToken = reqUrl.searchParams.get('cancelToken');
  const rescheduleToken = reqUrl.searchParams.get('rescheduleToken');
  if (cancelToken) qs.set('cancelToken', cancelToken);
  if (rescheduleToken) qs.set('rescheduleToken', rescheduleToken);
  if (asHost) qs.set('asHost', '1');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const hostStub = getHostStub(c.env, idx.data.hostId);
  const res = await doJson(hostStub, `/booking/uid/${encodeURIComponent(uid)}${suffix}`);
  return c.json(res.data, res.status as 200);
});

app.post('/api/bookings/public/:uid/cancel', async (c) => {
  const uid = c.req.param('uid');
  const dir = getDirectoryStub(c.env);
  const idx = await doJson<{ hostId?: string }>(dir, `/booking-index/${encodeURIComponent(uid)}`);
  if (idx.status >= 400 || !idx.data.hostId) {
    return c.json({ error: 'Booking not found.' }, 404);
  }
  const sessionUser = await resolveSessionUser(c);
  const asHost = sessionUser?.id === idx.data.hostId;
  const body = await c.req.json();
  const hostStub = getHostStub(c.env, idx.data.hostId);
  const origin = encodeURIComponent(getOrigin(c));
  const res = await doJson(hostStub, `/booking/uid/${encodeURIComponent(uid)}/cancel?origin=${origin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: body.token, reason: body.reason, asHost }),
  });
  return c.json(res.data, res.status as 200);
});

app.post('/api/bookings/public/:uid/reschedule', async (c) => {
  const uid = c.req.param('uid');
  const dir = getDirectoryStub(c.env);
  const idx = await doJson<{ hostId?: string }>(dir, `/booking-index/${encodeURIComponent(uid)}`);
  if (idx.status >= 400 || !idx.data.hostId) {
    return c.json({ error: 'Booking not found.' }, 404);
  }
  const sessionUser = await resolveSessionUser(c);
  const asHost = sessionUser?.id === idx.data.hostId;
  const body = await c.req.json();
  const hostStub = getHostStub(c.env, idx.data.hostId);
  const origin = encodeURIComponent(getOrigin(c));
  const res = await doJson(
    hostStub,
    `/booking/uid/${encodeURIComponent(uid)}/reschedule?origin=${origin}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: body.token,
        newStartUtc: body.newStartUtc,
        attendeeTimezone: body.attendeeTimezone,
        asHost,
      }),
    },
  );
  return c.json(res.data, res.status as 200);
});

app.get('/ics/:file', async (c) => {
  const file = c.req.param('file');
  const uid = file.replace(/\.ics$/i, '');
  const dir = getDirectoryStub(c.env);
  const idx = await doJson<{ hostId?: string }>(dir, `/booking-index/${encodeURIComponent(uid)}`);
  if (idx.status >= 400 || !idx.data.hostId) {
    return c.text('Booking not found', 404);
  }
  const hostStub = getHostStub(c.env, idx.data.hostId);
  const origin = encodeURIComponent(getOrigin(c));
  return hostStub.fetch(`https://do.internal/booking/ics/${encodeURIComponent(uid)}?origin=${origin}`);
});

// ---- Authenticated Host Dashboard Middleware ----

app.use('/api/dashboard/*', async (c, next) => {
  const user = await resolveSessionUser(c);
  if (!user) {
    return c.json({ error: 'Authentication required.' }, 401);
  }
  c.set('user', user);
  await next();
});

app.get('/api/dashboard/profile', async (c) => {
  const user = c.get('user')!;
  const res = await doJson(getHostStub(c.env, user.id), '/profile');
  return c.json(res.data, res.status as 200);
});

app.put('/api/dashboard/profile', async (c) => {
  const user = c.get('user')!;
  const body = (await c.req.json()) as {
    username?: string;
    name?: string;
    email?: string;
    bio?: string;
    timezone?: string;
    timeFormat?: string;
    brandColor?: string;
    avatarColor?: string;
    newPassword?: string;
  };

  if (body.username || body.email || body.name || body.newPassword) {
    const dir = getDirectoryStub(c.env);
    const dirRes = await doJson<{ user?: AuthUser; error?: string }>(dir, '/user/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        username: body.username,
        name: body.name,
        email: body.email,
        newPassword: body.newPassword,
      }),
    });
    if (dirRes.status >= 400) {
      return c.json({ error: dirRes.data.error || 'Update failed.' }, dirRes.status as 400);
    }
    if (dirRes.data.user) {
      body.username = dirRes.data.user.username;
      body.email = dirRes.data.user.email;
      body.name = dirRes.data.user.name;
    }
  }

  const res = await doJson(getHostStub(c.env, user.id), '/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return c.json(res.data, res.status as 200);
});

// Generic proxy helper for host-scoped dashboard routes
async function proxyHostDO(c: Context<{ Bindings: Env; Variables: { user?: AuthUser } }>, doPath: string) {
  const user = c.get('user')!;
  const stub = getHostStub(c.env, user.id);
  const origin = encodeURIComponent(getOrigin(c));
  const sep = doPath.includes('?') ? '&' : '?';
  const method = c.req.method;
  const init: RequestInit = { method };
  if (method !== 'GET' && method !== 'DELETE') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = await c.req.text();
  }
  const res = await doJson(stub, `${doPath}${sep}origin=${origin}`, init);
  return c.json(res.data, res.status as 200);
}

app.get('/api/dashboard/event-types', (c) => proxyHostDO(c, '/event-types'));
app.post('/api/dashboard/event-types', (c) => proxyHostDO(c, '/event-types'));
app.put('/api/dashboard/event-types/:id', (c) => proxyHostDO(c, `/event-types/${encodeURIComponent(c.req.param('id'))}`));
app.delete('/api/dashboard/event-types/:id', (c) => proxyHostDO(c, `/event-types/${encodeURIComponent(c.req.param('id'))}`));

app.get('/api/dashboard/schedules', (c) => proxyHostDO(c, '/schedules'));
app.post('/api/dashboard/schedules', (c) => proxyHostDO(c, '/schedules'));
app.put('/api/dashboard/schedules/:id', (c) => proxyHostDO(c, `/schedules/${encodeURIComponent(c.req.param('id'))}`));
app.delete('/api/dashboard/schedules/:id', (c) => proxyHostDO(c, `/schedules/${encodeURIComponent(c.req.param('id'))}`));
app.post('/api/dashboard/schedules/:id/overrides', (c) =>
  proxyHostDO(c, `/schedules/${encodeURIComponent(c.req.param('id'))}/overrides`),
);
app.delete('/api/dashboard/schedules/overrides/:overrideId', (c) =>
  proxyHostDO(c, `/schedules/overrides/${encodeURIComponent(c.req.param('overrideId'))}`),
);

app.get('/api/dashboard/bookings', (c) => proxyHostDO(c, '/bookings'));
app.post('/api/dashboard/bookings/:id/confirm', (c) =>
  proxyHostDO(c, `/bookings/${encodeURIComponent(c.req.param('id'))}/confirm`),
);
app.post('/api/dashboard/bookings/:id/cancel', (c) =>
  proxyHostDO(c, `/bookings/${encodeURIComponent(c.req.param('id'))}/cancel`),
);

app.get('/api/dashboard/webhooks', (c) => proxyHostDO(c, '/webhooks'));
app.post('/api/dashboard/webhooks', (c) => proxyHostDO(c, '/webhooks'));
app.put('/api/dashboard/webhooks/:id', (c) => proxyHostDO(c, `/webhooks/${encodeURIComponent(c.req.param('id'))}`));
app.delete('/api/dashboard/webhooks/:id', (c) => proxyHostDO(c, `/webhooks/${encodeURIComponent(c.req.param('id'))}`));
app.post('/api/dashboard/webhooks/:id/test', (c) =>
  proxyHostDO(c, `/webhooks/${encodeURIComponent(c.req.param('id'))}/test`),
);

app.get('/api/dashboard/integrations', (c) => proxyHostDO(c, '/integrations'));
app.put('/api/dashboard/integrations/:provider', (c) =>
  proxyHostDO(c, `/integrations/${encodeURIComponent(c.req.param('provider'))}`),
);
app.post('/api/dashboard/integrations/:provider/sync', (c) =>
  proxyHostDO(c, `/integrations/${encodeURIComponent(c.req.param('provider'))}/sync`),
);

app.get('/api/dashboard/status', (c) => proxyHostDO(c, '/status'));
app.get('/api/dashboard/export', (c) => proxyHostDO(c, '/export'));

// Static assets fallback (Cloudflare Workers Assets SPA)
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('EdgeCal Worker API running. Build frontend into ./dist for UI.', 200);
});

export default {
  fetch: app.fetch,
};
