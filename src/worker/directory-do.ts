import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto';
import type { Env } from './env';

type UserRow = {
  id: string;
  username: string;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
  role: string;
  created_at: string;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 32);
}

export class DirectoryDO {
  private ctx: DurableObjectState;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;

    this.ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'host',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS booking_index (
          uid TEXT PRIMARY KEY,
          host_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/status' && request.method === 'GET') {
        const countRow = this.sql
          .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users')
          .one();
        const firstUser = this.sql
          .exec<{ username: string }>('SELECT username FROM users ORDER BY created_at ASC LIMIT 1')
          .toArray()[0];

        return json({
          setupCompleted: (countRow?.cnt ?? 0) > 0,
          userCount: countRow?.cnt ?? 0,
          defaultUsername: firstUser?.username ?? null,
        });
      }

      if (path === '/setup' && request.method === 'POST') {
        const body = (await request.json()) as {
          username: string;
          email: string;
          name: string;
          password: string;
        };

        const countRow = this.sql
          .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users')
          .one();
        if ((countRow?.cnt ?? 0) > 0) {
          return json({ error: 'Setup has already been completed.' }, 409);
        }

        return this.createUserAndSession(body, 'admin');
      }

      if (path === '/signup' && request.method === 'POST') {
        const body = (await request.json()) as {
          username: string;
          email: string;
          name: string;
          password: string;
        };
        return this.createUserAndSession(body, 'host');
      }

      if (path === '/login' && request.method === 'POST') {
        const body = (await request.json()) as { identifier: string; password: string };
        const idNorm = (body.identifier || '').trim().toLowerCase();
        if (!idNorm || !body.password) {
          return json({ error: 'Email/username and password are required.' }, 400);
        }

        const rows = this.sql
          .exec<UserRow>(
            'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1',
            idNorm,
            idNorm,
          )
          .toArray();
        const user = rows[0];
        if (!user) {
          return json({ error: 'Invalid email/username or password.' }, 401);
        }

        const valid = await verifyPassword(body.password, user.password_hash, user.password_salt);
        if (!valid) {
          return json({ error: 'Invalid email/username or password.' }, 401);
        }

        const token = await this.issueSession(user.id);
        return json({
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        });
      }

      if (path === '/session/verify' && request.method === 'POST') {
        const body = (await request.json()) as { token: string };
        if (!body.token) return json({ user: null }, 200);

        const tokenHash = await sha256Hex(body.token);
        const now = Date.now();
        const rows = this.sql
          .exec<{
            id: string;
            username: string;
            email: string;
            name: string;
            role: string;
            expires_at: number;
          }>(
            `SELECT u.id, u.username, u.email, u.name, u.role, s.expires_at
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? LIMIT 1`,
            tokenHash,
          )
          .toArray();

        const row = rows[0];
        if (!row || row.expires_at < now) {
          if (row) {
            this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
          }
          return json({ user: null }, 200);
        }

        return json({
          user: {
            id: row.id,
            username: row.username,
            email: row.email,
            name: row.name,
            role: row.role,
          },
        });
      }

      if (path === '/session/logout' && request.method === 'POST') {
        const body = (await request.json()) as { token: string };
        if (body.token) {
          const tokenHash = await sha256Hex(body.token);
          this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
        }
        return json({ ok: true });
      }

      if (path === '/user/update' && request.method === 'PUT') {
        const body = (await request.json()) as {
          userId: string;
          username?: string;
          name?: string;
          email?: string;
          newPassword?: string;
        };

        const existing = this.sql
          .exec<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', body.userId)
          .toArray()[0];
        if (!existing) return json({ error: 'User not found.' }, 404);

        const nextUsername = body.username
          ? normalizeUsername(body.username)
          : existing.username;
        const nextEmail = body.email ? body.email.trim().toLowerCase() : existing.email;
        const nextName = body.name ? body.name.trim() : existing.name;

        if (nextUsername.length < 2) {
          return json({ error: 'Username must be at least 2 characters.' }, 400);
        }

        const conflict = this.sql
          .exec<{ id: string }>(
            'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ? LIMIT 1',
            nextUsername,
            nextEmail,
            body.userId,
          )
          .toArray()[0];
        if (conflict) {
          return json({ error: 'Username or email is already taken.' }, 409);
        }

        if (body.newPassword && body.newPassword.length >= 6) {
          const { hash, salt } = await hashPassword(body.newPassword);
          this.sql.exec(
            'UPDATE users SET username = ?, email = ?, name = ?, password_hash = ?, password_salt = ? WHERE id = ?',
            nextUsername,
            nextEmail,
            nextName,
            hash,
            salt,
            body.userId,
          );
        } else {
          this.sql.exec(
            'UPDATE users SET username = ?, email = ?, name = ? WHERE id = ?',
            nextUsername,
            nextEmail,
            nextName,
            body.userId,
          );
        }

        return json({
          user: {
            id: existing.id,
            username: nextUsername,
            email: nextEmail,
            name: nextName,
            role: existing.role,
          },
        });
      }

      if (path.startsWith('/resolve/username/') && request.method === 'GET') {
        const username = normalizeUsername(decodeURIComponent(path.slice('/resolve/username/'.length)));
        const row = this.sql
          .exec<{ id: string; username: string }>(
            'SELECT id, username FROM users WHERE username = ? LIMIT 1',
            username,
          )
          .toArray()[0];
        if (!row) return json({ error: 'Host not found.' }, 404);
        return json({ userId: row.id, username: row.username });
      }

      if (path === '/booking-index' && request.method === 'POST') {
        const body = (await request.json()) as { uid: string; hostId: string };
        this.sql.exec(
          'INSERT OR REPLACE INTO booking_index (uid, host_id, created_at) VALUES (?, ?, ?)',
          body.uid,
          body.hostId,
          new Date().toISOString(),
        );
        return json({ ok: true });
      }

      if (path.startsWith('/booking-index/') && request.method === 'GET') {
        const uid = decodeURIComponent(path.slice('/booking-index/'.length));
        const row = this.sql
          .exec<{ host_id: string }>(
            'SELECT host_id FROM booking_index WHERE uid = ? LIMIT 1',
            uid,
          )
          .toArray()[0];
        if (!row) return json({ error: 'Booking not found.' }, 404);
        return json({ hostId: row.host_id });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      return json({ error: msg }, 500);
    }
  }

  private async createUserAndSession(
    body: { username: string; email: string; name: string; password: string },
    role: string,
  ): Promise<Response> {
    const username = normalizeUsername(body.username || '');
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    const password = body.password || '';

    if (username.length < 2) {
      return json({ error: 'Username must be at least 2 lowercase letters or numbers.' }, 400);
    }
    if (!email.includes('@')) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    if (!name) {
      return json({ error: 'Display name is required.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400);
    }

    const exists = this.sql
      .exec<{ id: string }>(
        'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
        username,
        email,
      )
      .toArray()[0];
    if (exists) {
      return json({ error: 'An account with that username or email already exists.' }, 409);
    }

    const id = `usr_${randomToken(8)}`;
    const { hash, salt } = await hashPassword(password);
    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO users (id, username, email, name, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      username,
      email,
      name,
      hash,
      salt,
      role,
      createdAt,
    );

    const token = await this.issueSession(id);
    return json(
      {
        token,
        user: { id, username, email, name, role },
      },
      201,
    );
  }

  private async issueSession(userId: string): Promise<string> {
    const rawToken = randomToken(32);
    const tokenHash = await sha256Hex(rawToken);
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', now);
    this.sql.exec(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      userId,
      now + SESSION_TTL_MS,
      new Date(now).toISOString(),
    );
    return rawToken;
  }
}
