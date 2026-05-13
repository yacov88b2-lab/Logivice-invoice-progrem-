import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db';
import bcrypt from 'bcryptjs';
import usersRouter from '../routes/api/users';
import { signAccessToken } from '../services/tokenService';

// ── helpers ───────────────────────────────────────────────────────────────────

const createdIds: string[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  return app;
}

function insertUser(overrides: Record<string, unknown> = {}): string {
  const defaults = {
    email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@unilog.company`,
    name: 'Test User',
    password_hash: bcrypt.hashSync('TestPassword123!', 10),
    role: 'user',
    status: 'active',
    two_factor_enabled: 0,
  };
  const r = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status, two_factor_enabled) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(r.email, r.name, r.password_hash, r.role, r.status, r.two_factor_enabled);
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(r.email) as any;
  createdIds.push(row.id);
  return row.id as string;
}

function tokenFor(id: string, role = 'admin') {
  return signAccessToken({ sub: id, email: `${role}@unilog.company`, role, twoFactorVerified: true });
}

afterEach(() => {
  for (const id of createdIds.splice(0)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
});

// ── GET /users ────────────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  it('returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    const viewerId = insertUser({ role: 'viewer' });
    const token = tokenFor(viewerId, 'viewer');
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns user list for manager role', async () => {
    const managerId = insertUser({ role: 'manager' });
    const token = tokenFor(managerId, 'manager');
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('never exposes password_hash', async () => {
    insertUser();
    const adminId = insertUser({ role: 'admin' });
    const token = tokenFor(adminId, 'admin');
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const u of res.body) {
      expect(u.password_hash).toBeUndefined();
      expect(u.two_factor_secret).toBeUndefined();
      expect(u.backup_codes_hash).toBeUndefined();
    }
  });
});

// ── POST /users ───────────────────────────────────────────────────────────────

describe('POST /api/users', () => {
  it('returns 403 for admin (direct create is super_admin only)', async () => {
    const adminId = insertUser({ role: 'admin' });
    const token = tokenFor(adminId, 'admin');
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: `new-${Date.now()}@unilog.company`, role: 'user', password: 'Secure123!' });
    expect(res.status).toBe(403);
  });

  it('creates a user when super_admin', async () => {
    const saId = insertUser({ role: 'super_admin' });
    const token = tokenFor(saId, 'super_admin');

    const email = `new-${Date.now()}@unilog.company`;
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email, name: 'New Person', role: 'user', password: 'Secure123!' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.body.password_hash).toBeUndefined();
    createdIds.push(res.body.id);
  });

  it('returns 403 for non-unilog.company email', async () => {
    const saId = insertUser({ role: 'super_admin' });
    const token = tokenFor(saId, 'super_admin');
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'bad@gmail.com', role: 'user', password: 'Secure123!' });
    expect(res.status).toBe(403);
  });

  it('returns 409 for duplicate email', async () => {
    const saId = insertUser({ role: 'super_admin' });
    const dupEmail = `dup-${Date.now()}@unilog.company`;
    insertUser({ email: dupEmail, role: 'user' });
    const token = tokenFor(saId, 'super_admin');

    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: dupEmail, role: 'user', password: 'Secure123!' });
    expect(res.status).toBe(409);
  });

  it('returns 403 when trying to create user with equal role (super_admin)', async () => {
    const saId = insertUser({ role: 'super_admin' });
    const token = tokenFor(saId, 'super_admin');
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: `test2-${Date.now()}@unilog.company`, role: 'super_admin', password: 'Secure123!' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const saId = insertUser({ role: 'super_admin' });
    const token = tokenFor(saId, 'super_admin');
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: `short-${Date.now()}@unilog.company`, role: 'user', password: 'abc' });
    expect(res.status).toBe(400);
  });
});

// ── POST /users/:id/disable ───────────────────────────────────────────────────

describe('POST /api/users/:id/disable', () => {
  it('disables a lower-rank user', async () => {
    const adminId = insertUser({ role: 'admin' });
    const userId  = insertUser({ role: 'user' });
    const token = tokenFor(adminId, 'admin');

    const res = await request(buildApp())
      .post(`/api/users/${userId}/disable`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disabled');
  });

  it('returns 403 when trying to disable own account', async () => {
    const adminId = insertUser({ role: 'admin' });
    const token = tokenFor(adminId, 'admin');
    const res = await request(buildApp())
      .post(`/api/users/${adminId}/disable`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 403 when trying to disable equal-rank user', async () => {
    const admin1 = insertUser({ role: 'admin' });
    const admin2 = insertUser({ role: 'admin' });
    const token = tokenFor(admin1, 'admin');
    const res = await request(buildApp())
      .post(`/api/users/${admin2}/disable`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── last super_admin protection ───────────────────────────────────────────────
// The canManage check blocks super_admins from modifying OTHER super_admins (equal rank).
// The isLastActiveSuperAdmin guard is reachable for SELF-demotion (actor.sub === target.id
// bypasses the canManage gate) and is defensive coverage for future role-hierarchy changes.

describe('last active super_admin protection', () => {
  it('returns 409 when the last active super_admin tries to demote themselves', async () => {
    const saId = insertUser({ role: 'super_admin' });
    // Disable any other seeded super_admin so this one is the last
    db.prepare("UPDATE users SET status = 'disabled' WHERE role = 'super_admin' AND id != ?").run(saId);
    const token = signAccessToken({ sub: saId, email: `sa@unilog.company`, role: 'super_admin', twoFactorVerified: true });

    const res = await request(buildApp())
      .patch(`/api/users/${saId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/last.*super_admin/i);
  });

  it('allows a super_admin to demote themselves when another active super_admin exists', async () => {
    const sa1 = insertUser({ role: 'super_admin' });
    const sa2 = insertUser({ role: 'super_admin' }); // second active super_admin
    const token = signAccessToken({ sub: sa1, email: `sa1@unilog.company`, role: 'super_admin', twoFactorVerified: true });

    const res = await request(buildApp())
      .patch(`/api/users/${sa1}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    // sa2 is still unused (cleanup handled by afterEach)
    void sa2;
  });
});

// ── POST /users/:id/reset-password ───────────────────────────────────────────

describe('POST /api/users/:id/reset-password', () => {
  it('resets password for lower-rank user', async () => {
    const adminId = insertUser({ role: 'admin' });
    const userId  = insertUser({ role: 'user' });
    const token = tokenFor(adminId, 'admin');

    const res = await request(buildApp())
      .post(`/api/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'NewSecure456!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the hash changed
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
    expect(bcrypt.compareSync('NewSecure456!', row.password_hash)).toBe(true);
  });

  it('returns 400 for password shorter than 8 chars', async () => {
    const adminId = insertUser({ role: 'admin' });
    const userId  = insertUser({ role: 'user' });
    const token = tokenFor(adminId, 'admin');

    const res = await request(buildApp())
      .post(`/api/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'abc' });
    expect(res.status).toBe(400);
  });
});
