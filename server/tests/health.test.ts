import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import pricelistsRouter from '../routes/pricelists';
import tableauRouter from '../routes/tableau';
import authRouter from '../routes/api/auth';
import { signAccessToken } from '../services/tokenService';
import db from '../db';
import bcrypt from 'bcryptjs';

// Suppress tokenStore in tests
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  writable: true,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/pricelists', pricelistsRouter);
  app.use('/api/tableau', tableauRouter);
  app.get('/api/health', (_req, res) => {
    const storageRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'test',
      env: process.env.NODE_ENV ?? 'test',
      storageRoot,
      dbPath: path.join(storageRoot, 'database.sqlite'),
    });
  });
  return app;
}

// ── Health endpoint ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns status ok with expected fields', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.storageRoot).toBeTruthy();
    expect(res.body.commit).toBeTruthy();
  });
});

// ── Protected routes reject unauthenticated requests ─────────────────────────

describe('Protected routes require auth', () => {
  it('GET /api/pricelists returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/pricelists');
    expect(res.status).toBe(401);
  });

  it('GET /api/tableau/options returns 401 without token', async () => {
    const res = await request(buildApp()).get('/api/tableau/options');
    expect(res.status).toBe(401);
  });

  it('GET /api/pricelists returns 200 with valid token', async () => {
    // Use the existing super_admin seeded on startup
    const sa = db.prepare("SELECT id, role FROM users WHERE role = 'super_admin' LIMIT 1").get() as any;
    const token = signAccessToken({ sub: sa.id, email: 'test@unilog.company', role: sa.role, twoFactorVerified: true });
    const res = await request(buildApp())
      .get('/api/pricelists')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
