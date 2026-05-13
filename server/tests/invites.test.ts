import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import db from '../db';
import bcrypt from 'bcryptjs';
import { signAccessToken } from '../services/tokenService';
import authRouter from '../routes/api/auth';
import usersRouter from '../routes/api/users';

// Suppress tokenStore usage in tests
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  writable: true,
});

// ── helpers ───────────────────────────────────────────────────────────────────

const cleanup: { type: 'user_id' | 'user_email' | 'invite_id'; value: string }[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  return app;
}

function insertUser(overrides: Record<string, unknown> = {}): string {
  const email = overrides.email as string
    ?? `test-inv-${Date.now()}-${randomBytes(4).toString('hex')}@unilog.company`;
  const r = {
    email,
    name: 'Test User',
    password_hash: bcrypt.hashSync('TestPassword123!', 10),
    role: 'user',
    status: 'active',
    ...overrides,
  };
  db.prepare('DELETE FROM users WHERE email = ?').run(r.email);
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status) VALUES (?, ?, ?, ?, ?)`
  ).run(r.email, r.name, r.password_hash, r.role, r.status);
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(r.email) as any;
  cleanup.push({ type: 'user_id', value: row.id });
  return row.id as string;
}

function makeToken(userId: string, role: string, email?: string) {
  return signAccessToken({
    sub: userId,
    email: email ?? `${userId}@unilog.company`,
    role,
    twoFactorVerified: true,
  });
}

function insertInvite(overrides: Record<string, unknown> = {}): { id: string; token: string } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const invitorId = insertUser({ role: 'super_admin' });
  const email = overrides.email as string
    ?? `inv-${Date.now()}-${randomBytes(4).toString('hex')}@unilog.company`;
  const r = {
    email,
    role: 'user',
    name: 'Invited User',
    token_hash: tokenHash,
    invited_by_user_id: invitorId,
    status: 'pending',
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    ...overrides,
    // always override token_hash with the one we generated
    token_hash: tokenHash,
  };
  db.prepare(
    `INSERT INTO user_invites (email, role, name, token_hash, invited_by_user_id, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(r.email, r.role, r.name, r.token_hash, r.invited_by_user_id, r.status, r.expires_at);
  const row = db.prepare('SELECT id FROM user_invites WHERE token_hash = ?').get(tokenHash) as any;
  cleanup.push({ type: 'invite_id', value: row.id });
  cleanup.push({ type: 'user_email', value: email }); // in case invite gets accepted
  return { id: row.id, token };
}

afterEach(() => {
  const items = cleanup.splice(0);
  for (const item of items) {
    if (item.type === 'user_id')    db.prepare('DELETE FROM users WHERE id = ?').run(item.value);
    if (item.type === 'user_email') db.prepare('DELETE FROM users WHERE email = ?').run(item.value);
    if (item.type === 'invite_id')  db.prepare('DELETE FROM user_invites WHERE id = ?').run(item.value);
  }
});

// ── POST /api/users/invite ────────────────────────────────────────────────────

describe('POST /api/users/invite', () => {
  it('returns 401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/users/invite')
      .send({ email: 'new@unilog.company', role: 'user' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for manager (below admin threshold)', async () => {
    const mgr = insertUser({ role: 'manager' });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(mgr, 'manager')}`)
      .send({ email: 'new@unilog.company', role: 'user' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for invalid domain', async () => {
    const admin = insertUser({ role: 'admin' });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email: 'new@gmail.com', role: 'user' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unilog\.company/i);
  });

  it('returns 403 when admin invites equal role (admin)', async () => {
    const admin = insertUser({ role: 'admin' });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email: 'another@unilog.company', role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/equal to or above/i);
  });

  it('returns 403 when admin invites super_admin role', async () => {
    const admin = insertUser({ role: 'admin' });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email: 'sa@unilog.company', role: 'super_admin' });
    expect(res.status).toBe(403);
  });

  it('super_admin can invite admin role', async () => {
    const sa = insertUser({ role: 'super_admin' });
    const email = `admin-inv-${Date.now()}@unilog.company`;
    cleanup.push({ type: 'user_email', value: email });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(sa, 'super_admin')}`)
      .send({ email, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.invite.role).toBe('admin');
    if (res.body.invite.id) cleanup.push({ type: 'invite_id', value: res.body.invite.id });
  });

  it('admin can invite user role and returns invite + inviteLink', async () => {
    const admin = insertUser({ role: 'admin' });
    const email = `user-inv-${Date.now()}@unilog.company`;
    cleanup.push({ type: 'user_email', value: email });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email, name: 'John Doe', role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.invite).toBeDefined();
    expect(res.body.inviteLink).toContain('/register/accept?token=');
    expect(res.body.invite.email).toBe(email);
    expect(res.body.invite.name).toBe('John Doe');
    expect(res.body.invite.role).toBe('user');
    expect(res.body.invite.status).toBe('pending');
    if (res.body.invite.id) cleanup.push({ type: 'invite_id', value: res.body.invite.id });
  });

  it('invite response does not include token_hash', async () => {
    const admin = insertUser({ role: 'admin' });
    const email = `notokentest-${Date.now()}@unilog.company`;
    cleanup.push({ type: 'user_email', value: email });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email, role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.invite.token_hash).toBeUndefined();
    if (res.body.invite.id) cleanup.push({ type: 'invite_id', value: res.body.invite.id });
  });

  it('stores token_hash not the plain token', async () => {
    const admin = insertUser({ role: 'admin' });
    const email = `hashtest-${Date.now()}@unilog.company`;
    cleanup.push({ type: 'user_email', value: email });
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email, role: 'user' });
    expect(res.status).toBe(201);
    if (res.body.invite.id) cleanup.push({ type: 'invite_id', value: res.body.invite.id });

    const plainToken = new URL(res.body.inviteLink).searchParams.get('token')!;
    const dbInvite = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(res.body.invite.id) as any;

    expect(dbInvite.token_hash).not.toBe(plainToken);
    expect(dbInvite.token_hash).toBe(createHash('sha256').update(plainToken).digest('hex'));
  });

  it('returns 409 if pending invite already exists for email', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user' });
    const inv = db.prepare('SELECT email FROM user_invites WHERE id = ?').get(id) as any;

    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email: inv.email, role: 'user' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pending invite/i);
  });

  it('returns 409 when user with email already exists', async () => {
    const admin = insertUser({ role: 'admin' });
    const existing = insertUser({ role: 'user' });
    const existingRow = db.prepare('SELECT email FROM users WHERE id = ?').get(existing) as any;

    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email: existingRow.email, role: 'user' });
    expect(res.status).toBe(409);
  });

  it('writes user_invited audit log', async () => {
    const admin = insertUser({ role: 'admin' });
    const email = `auditinv-${Date.now()}@unilog.company`;
    cleanup.push({ type: 'user_email', value: email });

    const before = ((db.prepare('SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs').get() as any)?.m ?? 0) as number;
    const res = await request(buildApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`)
      .send({ email, role: 'user' });
    expect(res.status).toBe(201);
    if (res.body.invite.id) cleanup.push({ type: 'invite_id', value: res.body.invite.id });

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action = 'user_invited' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row).toBeTruthy();
    expect(JSON.parse(row.metadata).email).toBe(email);
  });
});

// ── GET /api/users/invites ────────────────────────────────────────────────────

describe('GET /api/users/invites', () => {
  it('returns 403 for manager', async () => {
    const mgr = insertUser({ role: 'manager' });
    const res = await request(buildApp())
      .get('/api/users/invites')
      .set('Authorization', `Bearer ${makeToken(mgr, 'manager')}`);
    expect(res.status).toBe(403);
  });

  it('returns invite list for admin (no token_hash)', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user' });
    const res = await request(buildApp())
      .get('/api/users/invites')
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const inv = res.body.find((i: any) => i.id === id);
    expect(inv).toBeDefined();
    expect(inv.token_hash).toBeUndefined();
  });
});

// ── POST /api/users/invites/:id/revoke ────────────────────────────────────────

describe('POST /api/users/invites/:id/revoke', () => {
  it('admin can revoke pending invite', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user' });
    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/revoke`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.token_hash).toBeUndefined();
  });

  it('returns 400 when invite is already revoked', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user', status: 'revoked' });
    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/revoke`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when invite is accepted', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user', status: 'accepted' });
    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/revoke`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(400);
  });

  it('writes user_invite_revoked audit log', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user' });
    const before = ((db.prepare('SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs').get() as any)?.m ?? 0) as number;

    await request(buildApp())
      .post(`/api/users/invites/${id}/revoke`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action = 'user_invite_revoked' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row).toBeTruthy();
  });
});

// ── POST /api/users/invites/:id/resend ────────────────────────────────────────

describe('POST /api/users/invites/:id/resend', () => {
  it('returns new inviteLink with fresh token', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id, token: oldToken } = insertInvite({ role: 'user' });

    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/resend`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.inviteLink).toContain('/register/accept?token=');
    const newToken = new URL(res.body.inviteLink).searchParams.get('token');
    expect(newToken).not.toBe(oldToken);
    expect(res.body.invite.status).toBe('pending');
    expect(res.body.invite.token_hash).toBeUndefined();
  });

  it('returns 400 for accepted invite', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user', status: 'accepted' });
    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/resend`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(400);
  });

  it('can reissue an expired invite', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({
      role: 'user',
      status: 'expired',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await request(buildApp())
      .post(`/api/users/invites/${id}/resend`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);
    expect(res.status).toBe(200);
    expect(new Date(res.body.invite.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes user_invite_resent audit log', async () => {
    const admin = insertUser({ role: 'admin' });
    const { id } = insertInvite({ role: 'user' });
    const before = ((db.prepare('SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs').get() as any)?.m ?? 0) as number;

    await request(buildApp())
      .post(`/api/users/invites/${id}/resend`)
      .set('Authorization', `Bearer ${makeToken(admin, 'admin')}`);

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action = 'user_invite_resent' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row).toBeTruthy();
  });
});

// ── GET /api/auth/invite/:token ───────────────────────────────────────────────

describe('GET /api/auth/invite/:token', () => {
  it('returns invite info for valid token', async () => {
    const { token } = insertInvite({ name: 'Jane Doe', role: 'viewer' });
    const res = await request(buildApp()).get(`/api/auth/invite/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBeDefined();
    expect(res.body.name).toBe('Jane Doe');
    expect(res.body.role).toBe('viewer');
    expect(res.body.expires_at).toBeDefined();
    expect(res.body.token_hash).toBeUndefined();
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(buildApp()).get(`/api/auth/invite/fakefakefakefake`);
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired invite', async () => {
    const { token } = insertInvite({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await request(buildApp()).get(`/api/auth/invite/${token}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 410 for revoked invite', async () => {
    const { token } = insertInvite({ status: 'revoked' });
    const res = await request(buildApp()).get(`/api/auth/invite/${token}`);
    expect(res.status).toBe(410);
  });

  it('returns 410 for accepted invite', async () => {
    const { token } = insertInvite({ status: 'accepted' });
    const res = await request(buildApp()).get(`/api/auth/invite/${token}`);
    expect(res.status).toBe(410);
  });
});

// ── POST /api/auth/invite/:token/accept ──────────────────────────────────────

describe('POST /api/auth/invite/:token/accept', () => {
  it('creates active user from valid invite', async () => {
    const { token } = insertInvite({ role: 'viewer' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;

    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Welcome1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(inv.email) as any;
    expect(user).toBeTruthy();
    expect(user.status).toBe('active');
    expect(user.role).toBe('viewer');
    cleanup.push({ type: 'user_id', value: user.id });
  });

  it('hashes password with bcrypt', async () => {
    const { token } = insertInvite({ role: 'user' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;

    await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd' });

    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(inv.email) as any;
    expect(user.password_hash).not.toBe('Passw0rd');
    expect(bcrypt.compareSync('Passw0rd', user.password_hash)).toBe(true);
    cleanup.push({ type: 'user_id', value: user.id });
  });

  it('marks invite as accepted', async () => {
    const { token, id } = insertInvite({ role: 'user' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;
    cleanup.push({ type: 'user_email', value: inv.email });

    await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });

    const updated = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(id) as any;
    expect(updated.status).toBe('accepted');
    expect(updated.accepted_at).toBeTruthy();
  });

  it('token cannot be reused after acceptance', async () => {
    const { token } = insertInvite({ role: 'user' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;
    cleanup.push({ type: 'user_email', value: inv.email });

    await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });

    const res2 = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Another1' });
    expect(res2.status).toBe(410);
  });

  it('returns 400 for password under 8 chars', async () => {
    const { token } = insertInvite({ role: 'user' });
    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Ab1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it('returns 400 for missing uppercase letter', async () => {
    const { token } = insertInvite({ role: 'user' });
    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'password1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  it('returns 400 for missing digit', async () => {
    const { token } = insertInvite({ role: 'user' });
    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Password' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/number/i);
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(buildApp())
      .post(`/api/auth/invite/notarealtoken/accept`)
      .send({ password: 'Passw0rd1' });
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired invite', async () => {
    const { token } = insertInvite({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 410 for revoked invite', async () => {
    const { token } = insertInvite({ status: 'revoked' });
    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });
    expect(res.status).toBe(410);
  });

  it('writes user_invite_accepted audit log', async () => {
    const { token } = insertInvite({ role: 'user' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;
    cleanup.push({ type: 'user_email', value: inv.email });

    const before = ((db.prepare('SELECT COALESCE(MAX(rowid),0) as m FROM user_audit_logs').get() as any)?.m ?? 0) as number;
    await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });

    const row = db.prepare(
      "SELECT * FROM user_audit_logs WHERE action = 'user_invite_accepted' AND rowid > ? ORDER BY rowid DESC LIMIT 1"
    ).get(before) as any;
    expect(row).toBeTruthy();
    const meta = JSON.parse(row.metadata);
    expect(meta.password_hash).toBeUndefined();
  });

  it('accept response does not include password_hash or token_hash', async () => {
    const { token } = insertInvite({ role: 'user' });
    const inv = db.prepare(
      'SELECT email FROM user_invites WHERE token_hash = ?'
    ).get(createHash('sha256').update(token).digest('hex')) as any;
    cleanup.push({ type: 'user_email', value: inv.email });

    const res = await request(buildApp())
      .post(`/api/auth/invite/${token}/accept`)
      .send({ password: 'Passw0rd1' });
    expect(res.status).toBe(200);
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.token_hash).toBeUndefined();
  });
});

// ── schema ────────────────────────────────────────────────────────────────────

describe('user_invites schema', () => {
  it('has all required columns', () => {
    const cols = (db.prepare('PRAGMA table_info(user_invites)').all() as { name: string }[]).map(c => c.name);
    for (const col of ['id', 'email', 'role', 'name', 'token_hash', 'invited_by_user_id',
                        'status', 'expires_at', 'accepted_at', 'created_at', 'updated_at']) {
      expect(cols, `missing column: ${col}`).toContain(col);
    }
  });

  it('does not store plain token — only hash', () => {
    const cols = (db.prepare('PRAGMA table_info(user_invites)').all() as { name: string }[]).map(c => c.name);
    expect(cols).not.toContain('token');
    expect(cols).toContain('token_hash');
  });
});
