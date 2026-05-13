import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db';
import bcrypt from 'bcryptjs';
import { generateSecret, generateSync } from 'otplib';
import authRouter from '../routes/api/auth';
import { signAccessToken } from '../services/tokenService';

// suppress tokenStore usage in tests
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  writable: true,
});

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_EMAIL    = 'test-auth@unilog.company';
const TEST_PASSWORD = 'TestPassword123!';

const createdIds: string[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

function insertUser(overrides: Record<string, unknown> = {}): string {
  const defaults = {
    email: TEST_EMAIL,
    name: 'Test User',
    password_hash: bcrypt.hashSync(TEST_PASSWORD, 10),
    role: 'user',
    status: 'active',
    two_factor_enabled: 0,
    two_factor_secret: null as string | null,
  };
  const r = { ...defaults, ...overrides };
  // Delete any existing user with this email first to avoid INSERT OR IGNORE silent failure
  db.prepare('DELETE FROM users WHERE email = ?').run(r.email);
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status, two_factor_enabled, two_factor_secret)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(r.email, r.name, r.password_hash, r.role, r.status, r.two_factor_enabled, r.two_factor_secret);
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(r.email) as any;
  return row.id as string;
}

afterEach(() => {
  for (const id of createdIds.splice(0)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 400 when email or password missing', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({ email: TEST_EMAIL });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 401 with generic error for non-unilog.company email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'attacker@gmail.com', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@unilog.company', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    const id = insertUser();
    createdIds.push(id);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongPassword!' });
    expect(res.status).toBe(401);
  });

  it('returns token + user on valid login', async () => {
    const id = insertUser();
    createdIds.push(id);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.two_factor_secret).toBeUndefined();
  });

  it('returns requiresTwoFactor + preToken when 2FA is enabled', async () => {
    // authenticator already imported at top
    const secret = generateSecret();
    const id = insertUser({ two_factor_enabled: 1, two_factor_secret: secret });
    createdIds.push(id);

    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.preToken).toBeTruthy();
    expect(res.body.token).toBeUndefined();
  });

  it('returns 403 for disabled account', async () => {
    const id = insertUser({ status: 'disabled' });
    createdIds.push(id);
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });
});

// ── 2FA verify ────────────────────────────────────────────────────────────────

describe('POST /api/auth/2fa-verify', () => {
  it('returns 400 when preToken or code missing', async () => {
    const res = await request(buildApp())
      .post('/api/auth/2fa-verify')
      .send({ preToken: 'tok' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid preToken', async () => {
    const res = await request(buildApp())
      .post('/api/auth/2fa-verify')
      .send({ preToken: 'not.a.valid.jwt', code: '123456' });
    expect(res.status).toBe(401);
  });

  it('accepts valid TOTP code and returns full token', async () => {
    // authenticator already imported at top
    const secret = generateSecret();
    const id = insertUser({ two_factor_enabled: 1, two_factor_secret: secret });
    createdIds.push(id);

    // Get a preToken via login
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(loginRes.body.preToken).toBeTruthy();

    const code = generateSync({ secret });
    const verifyRes = await request(buildApp())
      .post('/api/auth/2fa-verify')
      .send({ preToken: loginRes.body.preToken, code });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeTruthy();
    expect(verifyRes.body.user).toBeDefined();
  });

  it('returns 401 for wrong TOTP code', async () => {
    // authenticator already imported at top
    const secret = generateSecret();
    const id = insertUser({ two_factor_enabled: 1, two_factor_secret: secret });
    createdIds.push(id);

    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const verifyRes = await request(buildApp())
      .post('/api/auth/2fa-verify')
      .send({ preToken: loginRes.body.preToken, code: '000000' });
    expect(verifyRes.status).toBe(401);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns current user with valid token', async () => {
    const id = insertUser();
    createdIds.push(id);
    const loginRes = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const token = loginRes.body.token;

    const meRes = await request(buildApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(TEST_EMAIL);
    expect(meRes.body.password_hash).toBeUndefined();
  });
});

// ── preToken must not access protected endpoints ──────────────────────────────

describe('pre-2FA token is rejected by requireAuth', () => {
  it('GET /auth/me rejects pre-2FA token with 401', async () => {
    const preToken = signAccessToken({
      sub: 'fake-id',
      email: 'test@unilog.company',
      role: 'user',
      twoFactorVerified: false,
    });
    const res = await request(buildApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${preToken}`);
    expect(res.status).toBe(401);
  });

  it('POST /auth/logout rejects pre-2FA token with 401', async () => {
    const preToken = signAccessToken({
      sub: 'fake-id',
      email: 'test@unilog.company',
      role: 'user',
      twoFactorVerified: false,
    });
    const res = await request(buildApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${preToken}`);
    expect(res.status).toBe(401);
  });
});

// ── login_failed audit log privacy ───────────────────────────────────────────

describe('login_failed audit metadata does not contain full email', () => {
  // Use json_extract so we can isolate our specific records even when
  // other test files (e.g. apiProtection.test.ts) write concurrent audit rows.

  it('login_failed records written by the current code never contain email', async () => {
    // Capture the high-water mark so we only inspect records created during this test.
    // Pre-fix records from earlier runs are excluded — they're an accepted legacy artifact.
    const before = ((db.prepare('SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs').get() as any)?.m ?? 0) as number;

    await request(buildApp()).post('/api/auth/login').send({ email: 'canary@unilog.company', password: 'wrongpass' });

    const rows = db
      .prepare("SELECT metadata FROM user_audit_logs WHERE action='login_failed' AND rowid > ? AND metadata IS NOT NULL")
      .all(before) as { metadata: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const meta = JSON.parse(row.metadata);
      expect(meta.email, 'login_failed audit must never store the email address').toBeUndefined();
    }
  });

  it('wrong domain: stores domain + domainAllowed=false', async () => {
    // Use a domain unique to this test run to avoid collision with parallel test files.
    const uniqueDomain = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.invalid`;
    await request(buildApp())
      .post('/api/auth/login')
      .send({ email: `x@${uniqueDomain}`, password: 'x' });

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action = 'login_failed' AND json_extract(metadata, '$.domain') = ? ORDER BY rowid DESC LIMIT 1"
    ).get(uniqueDomain) as any;
    expect(row, 'audit record should be written for wrong-domain attempt').toBeTruthy();
    const meta = JSON.parse(row.metadata);
    expect(meta.email).toBeUndefined();
    expect(meta.domain).toBe(uniqueDomain);
    expect(meta.domainAllowed).toBe(false);
  });

  it('unknown unilog.company user: stores domain + domainAllowed=true', async () => {
    const before = (db
      .prepare("SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs WHERE action='login_failed' AND json_extract(metadata,'$.domain')='unilog.company'")
      .get() as any).m as number;

    await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'nobody-audit-probe@unilog.company', password: 'wrongpass' });

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action='login_failed' AND json_extract(metadata,'$.domain')='unilog.company' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row, 'audit record should be written for unknown-user attempt').toBeTruthy();
    const meta = JSON.parse(row.metadata);
    expect(meta.email).toBeUndefined();
    expect(meta.domain).toBe('unilog.company');
    expect(meta.domainAllowed).toBe(true);
  });

  it('wrong password for existing user: stores domain, not the email', async () => {
    const id = insertUser();
    createdIds.push(id);

    const before = (db
      .prepare("SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs WHERE action='login_failed' AND json_extract(metadata,'$.domain')='unilog.company'")
      .get() as any).m as number;

    await request(buildApp())
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action='login_failed' AND json_extract(metadata,'$.domain')='unilog.company' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row, 'audit record should be written for wrong-password attempt').toBeTruthy();
    const meta = JSON.parse(row.metadata);
    expect(meta.email).toBeUndefined();
    expect(meta.domain).toBe('unilog.company');
    expect(meta.domainAllowed).toBe(true);
  });
});

// ── schema ────────────────────────────────────────────────────────────────────

describe('users table schema', () => {
  it('has all required columns', () => {
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    for (const col of ['id', 'email', 'name', 'password_hash', 'role', 'status',
                        'two_factor_enabled', 'two_factor_secret', 'backup_codes_hash',
                        'last_login_at', 'created_at', 'updated_at']) {
      expect(cols, `missing column: ${col}`).toContain(col);
    }
  });

  it('has user_audit_logs table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_audit_logs'").get();
    expect(row).toBeTruthy();
  });

  it('super_admin exists', () => {
    const row = db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get();
    expect(row).toBeTruthy();
  });
});
