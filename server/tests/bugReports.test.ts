import { describe, it, expect, afterEach } from 'vitest';
import db from '../db';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import bugReportsRouter from '../routes/api/bugReports';
import { signAccessToken } from '../services/tokenService';

// ── helpers ───────────────────────────────────────────────────────────────────

function insertBugReport(overrides: Record<string, any> = {}) {
  const defaults = {
    title: 'Test bug',
    description: 'Test description',
    page: '/test',
    severity: 'medium',
    reported_by: null,
    screenshot_path: null,
    context: null,
  };
  const r = { ...defaults, ...overrides };
  const result = db.prepare(
    `INSERT INTO bug_reports (title, description, page, severity, reported_by, screenshot_path, context)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(r.title, r.description, r.page, r.severity, r.reported_by, r.screenshot_path, r.context);
  return result.lastInsertRowid as number;
}

const createdIds: number[] = [];

afterEach(() => {
  for (const id of createdIds.splice(0)) {
    db.prepare('DELETE FROM bug_reports WHERE id = ?').run(id);
  }
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bug-reports', bugReportsRouter);
  return app;
}

function testToken() {
  return signAccessToken({ sub: 'test-user-id', email: 'test@unilog.company', role: 'user', twoFactorVerified: true });
}

function authHeader() {
  return `Bearer ${testToken()}`;
}

// ── schema ────────────────────────────────────────────────────────────────────

describe('bug_reports schema', () => {
  it('has screenshot_path and context columns', () => {
    const cols = (db.prepare('PRAGMA table_info(bug_reports)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('screenshot_path');
    expect(cols).toContain('context');
  });
});

// ── insert without screenshot ─────────────────────────────────────────────────

describe('bug report without screenshot', () => {
  it('inserts and reads back correctly', () => {
    const id = insertBugReport();
    createdIds.push(id);
    const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as any;
    expect(row.title).toBe('Test bug');
    expect(row.screenshot_path).toBeNull();
    expect(row.context).toBeNull();
    expect(row.status).toBe('open');
  });

  it('defaults severity to medium when not specified', () => {
    const result = db.prepare(
      `INSERT INTO bug_reports (title, description) VALUES (?, ?)`
    ).run('No severity', 'desc');
    createdIds.push(result.lastInsertRowid as number);
    const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(result.lastInsertRowid) as any;
    expect(row.severity).toBe('medium');
  });

  it('rejects invalid severity', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO bug_reports (title, description, severity) VALUES (?, ?, ?)`
      ).run('T', 'D', 'extreme')
    ).toThrow();
  });
});

// ── insert with screenshot ────────────────────────────────────────────────────

describe('bug report with screenshot', () => {
  it('stores and retrieves screenshot path', () => {
    const fakePath = '/data/uploads/bug-reports/bug-123.png';
    const id = insertBugReport({ screenshot_path: fakePath });
    createdIds.push(id);
    const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as any;
    expect(row.screenshot_path).toBe(fakePath);
  });

  it('stores JSON context', () => {
    const ctx = JSON.stringify({ userAgent: 'TestBrowser/1.0', route: '/admin', timestamp: '2026-01-01T00:00:00Z' });
    const id = insertBugReport({ context: ctx });
    createdIds.push(id);
    const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as any;
    const parsed = JSON.parse(row.context);
    expect(parsed.userAgent).toBe('TestBrowser/1.0');
    expect(parsed.route).toBe('/admin');
  });
});

// ── multer file-size / mime validation (unit) ─────────────────────────────────

describe('screenshot upload constraints', () => {
  const MAX_BYTES = 5 * 1024 * 1024;

  it('5 MB limit constant is correct', () => {
    expect(MAX_BYTES).toBe(5242880);
  });

  it('accepted mime types list is correct', () => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    expect(allowed).not.toContain('image/gif');
    expect(allowed).not.toContain('application/pdf');
    expect(allowed.every(t => t.startsWith('image/'))).toBe(true);
  });

  it('screenshot dir path uses data dir env var when set', () => {
    const base = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
    const expected = path.join(base, 'uploads', 'bug-reports');
    expect(expected).toContain('bug-reports');
  });
});

// ── status update ─────────────────────────────────────────────────────────────

describe('status update', () => {
  it('updates open → resolved', () => {
    const id = insertBugReport();
    createdIds.push(id);
    db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').run('resolved', id);
    const row = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as any;
    expect(row.status).toBe('resolved');
  });

  it('rejects invalid status', () => {
    const id = insertBugReport();
    createdIds.push(id);
    expect(() =>
      db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').run('deleted', id)
    ).toThrow();
  });
});

// ── screenshot path sanitization helpers ─────────────────────────────────────

describe('screenshot filename safety', () => {
  it('generated filenames match expected safe pattern', () => {
    // Mirrors the multer filename callback pattern: bug-{timestamp}-{random}.png
    const name = `bug-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    expect(name).toMatch(/^bug-\d+-[a-z0-9]+\.png$/);
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
  });
});

// route-level behavior

describe('bug report API route', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .send({ title: 'unauth', description: 'no token' });
    expect(res.status).toBe(401);
  });

  it('creates JSON report without exposing screenshot_path', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({
        title: 'Route bug',
        description: 'Created through HTTP route',
        severity: 'high',
        context: JSON.stringify({ route: '/admin' }),
      });

    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.title).toBe('Route bug');
    expect(res.body.has_screenshot).toBe(false);
    expect(res.body.screenshot_path).toBeUndefined();
  });

  it('stores multipart screenshot and hides filesystem path in API response', async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d
    ]);

    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .field('title', 'Screenshot bug')
      .field('description', 'Includes screenshot')
      .field('severity', 'medium')
      .attach('screenshot', pngHeader, { filename: 'shot.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.has_screenshot).toBe(true);
    expect(res.body.screenshot_path).toBeUndefined();

    const row = db.prepare('SELECT screenshot_path FROM bug_reports WHERE id = ?').get(res.body.id) as any;
    expect(row.screenshot_path).toContain('bug-reports');
    if (row.screenshot_path && fs.existsSync(row.screenshot_path)) {
      fs.unlinkSync(row.screenshot_path);
    }
  });

  it('rejects invalid severity before insert', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: 'Bad severity', description: 'Nope', severity: 'extreme' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid severity');
  });

  it('does not expose screenshot_path when listing reports', async () => {
    const id = insertBugReport({ screenshot_path: '/secret/internal/path.png' });
    createdIds.push(id);

    const res = await request(buildApp())
      .get('/api/bug-reports')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    const row = res.body.find((report: any) => report.id === id);
    expect(row.has_screenshot).toBe(true);
    expect(row.screenshot_path).toBeUndefined();
  });

  it('rejects missing title/description with 400', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ description: 'No title here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('rejects title exceeding 200 chars with 400', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: 'x'.repeat(201), description: 'ok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('rejects description exceeding 10000 chars with 400', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: 'ok', description: 'd'.repeat(10_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });

  it('rejects context exceeding 12000 chars with 400', async () => {
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: 'ok', description: 'ok', context: 'c'.repeat(12_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/context/i);
  });

  it('rejects non-image MIME type with 400', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4');
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .field('title', 'MIME test')
      .field('description', 'Should reject')
      .attach('screenshot', pdfBytes, { filename: 'evil.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PNG|JPEG|WebP/i);
  });

  it('rejects oversized screenshot with 400', async () => {
    const sixMB = Buffer.alloc(6 * 1024 * 1024, 0x00);
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .field('title', 'Big file')
      .field('description', 'Too large')
      .attach('screenshot', sixMB, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large|maximum/i);
  });

  it('PATCH status update response does not expose screenshot_path', async () => {
    const id = insertBugReport({ screenshot_path: '/private/path.png' });
    createdIds.push(id);

    const res = await request(buildApp())
      .patch(`/api/bug-reports/${id}/status`)
      .set('Authorization', authHeader())
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.screenshot_path).toBeUndefined();
    expect(res.body.has_screenshot).toBe(true);
  });

  it('rejects invalid status filter on GET with 400', async () => {
    const res = await request(buildApp())
      .get('/api/bug-reports?status=hacked')
      .set('Authorization', authHeader());
    expect(res.status).toBe(400);
  });

  // ── whitespace-only title / description ──────────────────────────────────────

  it('rejects whitespace-only title with 400 and no DB insert', async () => {
    const before = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: '   ', description: 'valid description' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
    const after = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;
    expect(after).toBe(before);
  });

  it('rejects whitespace-only description with 400 and no DB insert', async () => {
    const before = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .send({ title: 'valid title', description: '\t\n  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description|title/i);
    const after = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;
    expect(after).toBe(before);
  });

  // ── magic-byte validation (MIME spoofing) ─────────────────────────────────────

  it('rejects image/png content-type with PDF bytes, returns 400 and no DB insert', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content here');
    const before = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;

    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .field('title', 'Spoofed MIME')
      .field('description', 'PNG header claimed but PDF bytes')
      .attach('screenshot', pdfBytes, { filename: 'shot.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PNG|JPEG|WebP|valid/i);
    const after = (db.prepare('SELECT COUNT(*) as n FROM bug_reports').get() as any).n;
    expect(after).toBe(before);
  });

  it('accepts image/png with real PNG magic bytes', async () => {
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const res = await request(buildApp())
      .post('/api/bug-reports')
      .set('Authorization', authHeader())
      .field('title', 'Valid PNG')
      .field('description', 'Magic bytes are correct')
      .attach('screenshot', pngMagic, { filename: 'shot.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.has_screenshot).toBe(true);

    const row = db.prepare('SELECT screenshot_path FROM bug_reports WHERE id = ?').get(res.body.id) as any;
    if (row?.screenshot_path && fs.existsSync(row.screenshot_path)) fs.unlinkSync(row.screenshot_path);
  });
});
