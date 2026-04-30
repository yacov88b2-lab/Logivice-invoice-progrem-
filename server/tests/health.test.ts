import { describe, it, expect } from 'vitest';

describe('Railway health endpoint (live)', () => {
  const BASE = 'https://logivice-api-production.up.railway.app';

  it('GET /api/health returns status ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(data.status).toBe('ok');
    expect(data.commit).toBeTruthy();
    expect(data.storageRoot).toBeTruthy();
  });

  it('GET /api/pricelists returns an array', async () => {
    const res = await fetch(`${BASE}/api/pricelists`);
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/tableau/options returns customers and warehouses arrays', async () => {
    const res = await fetch(`${BASE}/api/tableau/options`);
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(Array.isArray(data.customers)).toBe(true);
    expect(Array.isArray(data.warehouses)).toBe(true);
  });
});
