import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import pricelistsRouter from '../routes/pricelists';
import rulesRouter from '../routes/api/rules';
import generateRouter from '../routes/api/generate';
import tableauRouter from '../routes/tableau';
import deployRouter from '../routes/deploy';
import bugReportsRouter from '../routes/api/bugReports';
import authRouter from '../routes/api/auth';
import { signAccessToken } from '../services/tokenService';

function preToken() {
  return signAccessToken({ sub: 'fake', email: 'test@unilog.company', role: 'user', twoFactorVerified: false });
}

// ── unauthenticated requests must be rejected ─────────────────────────────────

describe('unauthenticated requests return 401', () => {
  it('GET /api/pricelists', async () => {
    const app = express();
    app.use('/api/pricelists', pricelistsRouter);
    const res = await request(app).get('/api/pricelists');
    expect(res.status).toBe(401);
  });

  it('GET /api/rules', async () => {
    const app = express();
    app.use('/api/rules', rulesRouter);
    const res = await request(app).get('/api/rules');
    expect(res.status).toBe(401);
  });

  it('GET /api/generate', async () => {
    const app = express();
    app.use('/api/generate', generateRouter);
    const res = await request(app).get('/api/generate');
    expect(res.status).toBe(401);
  });

  it('GET /api/tableau/options', async () => {
    const app = express();
    app.use('/api/tableau', tableauRouter);
    const res = await request(app).get('/api/tableau/options');
    expect(res.status).toBe(401);
  });

  it('GET /api/deploy/status', async () => {
    const app = express();
    app.use('/api/deploy', deployRouter);
    const res = await request(app).get('/api/deploy/status');
    expect(res.status).toBe(401);
  });

  it('GET /api/bug-reports', async () => {
    const app = express();
    app.use('/api/bug-reports', bugReportsRouter);
    const res = await request(app).get('/api/bug-reports');
    expect(res.status).toBe(401);
  });
});

// ── pre-2FA tokens must be rejected ──────────────────────────────────────────

describe('pre-2FA tokens are rejected by all protected routes', () => {
  it('GET /api/pricelists with preToken returns 401', async () => {
    const app = express();
    app.use('/api/pricelists', pricelistsRouter);
    const res = await request(app)
      .get('/api/pricelists')
      .set('Authorization', `Bearer ${preToken()}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/rules with preToken returns 401', async () => {
    const app = express();
    app.use('/api/rules', rulesRouter);
    const res = await request(app)
      .get('/api/rules')
      .set('Authorization', `Bearer ${preToken()}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/bug-reports with preToken returns 401', async () => {
    const app = express();
    app.use('/api/bug-reports', bugReportsRouter);
    const res = await request(app)
      .get('/api/bug-reports')
      .set('Authorization', `Bearer ${preToken()}`);
    expect(res.status).toBe(401);
  });
});

// ── login email domain validation ─────────────────────────────────────────────

describe('login rejects non-unilog.company emails with generic 401', () => {
  function buildAuthApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    return app;
  }

  it('rejects gmail.com email', async () => {
    const res = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'user@gmail.com', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects subdomain of unilog.company', async () => {
    const res = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'user@mail.unilog.company', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects domain that contains unilog.company as substring', async () => {
    const res = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'user@evil-unilog.company', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects domain unilog.company.attacker.com', async () => {
    const res = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'user@unilog.company.attacker.com', password: 'anything' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('does not leak whether the email domain is allowed or not (same 401)', async () => {
    const domainRes = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'user@gmail.com', password: 'wrong' });
    const credRes = await request(buildAuthApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@unilog.company', password: 'wrong' });
    expect(domainRes.status).toBe(401);
    expect(credRes.status).toBe(401);
    expect(domainRes.body.error).toBe(credRes.body.error);
  });
});
