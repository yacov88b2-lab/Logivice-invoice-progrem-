import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import db from '../db';
import bcrypt from 'bcryptjs';
import { ensureSuperAdmin } from '../db';

// ── helpers ───────────────────────────────────────────────────────────────────

const createdIds: string[] = [];

afterEach(() => {
  for (const id of createdIds.splice(0)) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
});

function uniqueEmail(): string {
  return `seed-${randomBytes(6).toString('hex')}@unilog.company`;
}

function insertRaw(email: string, role: string, status: string, passwordHash = ''): string {
  db.prepare('DELETE FROM users WHERE LOWER(email) = ?').run(email.toLowerCase());
  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, status) VALUES (?, 'Test', ?, ?, ?)`
  ).run(email, passwordHash, role, status);
  const row = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email.toLowerCase()) as any;
  createdIds.push(row.id);
  return row.id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ensureSuperAdmin', () => {
  afterEach(() => {
    delete process.env.SUPER_ADMIN_FORCE_PASSWORD_RESET;
  });

  it('creates super_admin with hashed password when email does not exist', () => {
    const email = uniqueEmail();
    cleanup(email);
    ensureSuperAdmin(email, 'TestPass1');
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    createdIds.push(user.id);
    expect(user.role).toBe('super_admin');
    expect(user.status).toBe('active');
    expect(user.email).toBe(email.toLowerCase());
    expect(bcrypt.compareSync('TestPass1', user.password_hash)).toBe(true);
  });

  it('old disabled super_admin with different email does not block configured email', () => {
    const oldEmail = uniqueEmail();
    insertRaw(oldEmail, 'super_admin', 'disabled', bcrypt.hashSync('oldpass', 10));

    const configEmail = uniqueEmail();
    cleanup(configEmail);
    ensureSuperAdmin(configEmail, 'NewPass1A');
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(configEmail) as any;
    createdIds.push(user.id);
    expect(user.role).toBe('super_admin');
    expect(user.status).toBe('active');
  });

  it('existing disabled configured user gets promoted to super_admin and activated', () => {
    const email = uniqueEmail();
    const hash = bcrypt.hashSync('ExistPass1', 10);
    insertRaw(email, 'user', 'disabled', hash);

    ensureSuperAdmin(email, 'DoNotUse1');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.role).toBe('super_admin');
    expect(updated.status).toBe('active');
  });

  it('existing lower-role configured user gets promoted to super_admin', () => {
    const email = uniqueEmail();
    const hash = bcrypt.hashSync('UserPass1A', 10);
    insertRaw(email, 'admin', 'active', hash);

    ensureSuperAdmin(email, 'DoNotUse2');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.role).toBe('super_admin');
  });

  it('does not overwrite existing password_hash', () => {
    const email = uniqueEmail();
    const originalHash = bcrypt.hashSync('OriginalPass1', 10);
    insertRaw(email, 'admin', 'active', originalHash);

    ensureSuperAdmin(email, 'DifferentPass1');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.password_hash).toBe(originalHash);
    expect(bcrypt.compareSync('OriginalPass1', updated.password_hash)).toBe(true);
    expect(bcrypt.compareSync('DifferentPass1', updated.password_hash)).toBe(false);
  });

  it('overwrites existing password_hash when force reset is enabled', () => {
    const email = uniqueEmail();
    const originalHash = bcrypt.hashSync('OriginalPass1', 10);
    insertRaw(email, 'admin', 'active', originalHash);

    process.env.SUPER_ADMIN_FORCE_PASSWORD_RESET = 'true';
    ensureSuperAdmin(email, 'DifferentPass1');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.password_hash).not.toBe(originalHash);
    expect(bcrypt.compareSync('DifferentPass1', updated.password_hash)).toBe(true);
  });

  it('sets password from rawPassword argument when user has empty password_hash', () => {
    const email = uniqueEmail();
    insertRaw(email, 'user', 'invited', ''); // empty hash (invite-accepted but no password)

    ensureSuperAdmin(email, 'FreshPass1A');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.role).toBe('super_admin');
    expect(updated.status).toBe('active');
    expect(bcrypt.compareSync('FreshPass1A', updated.password_hash)).toBe(true);
  });

  it('normalizes email to lowercase on create', () => {
    const base = randomBytes(6).toString('hex');
    const mixedEmail = `Seed-${base}@Unilog.Company`;
    cleanup(mixedEmail.toLowerCase());
    ensureSuperAdmin(mixedEmail, 'LowerPass1');
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(mixedEmail.toLowerCase()) as any;
    createdIds.push(user.id);
    expect(user.email).toBe(mixedEmail.toLowerCase());
  });

  it('normalizes email to lowercase on update', () => {
    const base = randomBytes(6).toString('hex');
    const lowerEmail = `seed-up-${base}@unilog.company`;
    insertRaw(lowerEmail, 'user', 'active', bcrypt.hashSync('OldPass1', 10));

    // Call with mixed-case — should still find and update
    ensureSuperAdmin(lowerEmail.replace('seed', 'Seed'), 'NotUsed1');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(lowerEmail) as any;
    expect(updated.role).toBe('super_admin');
    expect(updated.email).toBe(lowerEmail);
  });

  it('is idempotent: second call on already-correct super_admin is a no-op', () => {
    const email = uniqueEmail();
    const hash = bcrypt.hashSync('StablePass1', 10);
    insertRaw(email, 'super_admin', 'active', hash);

    ensureSuperAdmin(email, 'DoNotUse3');
    ensureSuperAdmin(email, 'DoNotUse3');

    const updated = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as any;
    expect(updated.password_hash).toBe(hash); // unchanged
    expect(updated.role).toBe('super_admin');
    expect(updated.status).toBe('active');
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function cleanup(email: string) {
  db.prepare('DELETE FROM users WHERE LOWER(email) = ?').run(email.toLowerCase());
}
