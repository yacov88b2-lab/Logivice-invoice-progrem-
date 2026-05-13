import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../../db';
import { requireAuth, requireMinRole, type AuthenticatedRequest } from '../../middleware/auth';
import { isAllowedEmail, normalizeEmail } from '../../services/emailDomain';
import { logAudit } from '../../services/auditService';

const router = express.Router();

// All user-management endpoints require auth
router.use(requireAuth);

const ROLES = ['super_admin', 'admin', 'manager', 'user', 'viewer'] as const;
type Role = typeof ROLES[number];

const ROLE_RANK: Record<Role, number> = {
  super_admin: 5, admin: 4, manager: 3, user: 2, viewer: 1,
};

function publicUser(row: any) {
  const { password_hash: _p, two_factor_secret: _s, backup_codes_hash: _b, ...rest } = row;
  return rest;
}

function canManage(actorRole: Role, targetRole: Role): boolean {
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

function isLastActiveSuperAdmin(userId: string): boolean {
  const count = (db.prepare(
    "SELECT COUNT(*) as n FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?"
  ).get(userId) as any).n;
  return count === 0;
}

// ── GET /users ────────────────────────────────────────────────────────────────

router.get('/', requireMinRole('manager'), (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(rows.map(publicUser));
});

// ── GET /users/:id ────────────────────────────────────────────────────────────

router.get('/:id', requireMinRole('manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(row));
});

// ── POST /users ───────────────────────────────────────────────────────────────

router.post('/', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const { email, name, role = 'user', password } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const normalizedEmail = normalizeEmail(String(email));
  if (!isAllowedEmail(normalizedEmail)) return res.status(403).json({ error: 'Only @unilog.company emails are permitted' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!canManage(actor.role as Role, role as Role)) {
    return res.status(403).json({ error: 'You cannot create a user with a role equal to or above your own' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const passwordHash = bcrypt.hashSync(password, 12);

  try {
    const result = db.prepare(
      `INSERT INTO users (email, name, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')`
    ).run(normalizedEmail, name || null, passwordHash, role);

    const newUser = db.prepare('SELECT * FROM users WHERE rowid = ?').get(result.lastInsertRowid) as any;
    logAudit({ actorId: actor.sub, targetId: newUser?.id, action: 'user_created', metadata: { email, role }, req });
    res.status(201).json(publicUser(newUser));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
});

// ── PATCH /users/:id ─────────────────────────────────────────────────────────

router.patch('/:id', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (!canManage(actor.role as Role, target.role as Role) && actor.sub !== target.id) {
    return res.status(403).json({ error: 'Insufficient permissions to modify this user' });
  }

  const { name, role } = req.body;
  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (!canManage(actor.role as Role, role as Role)) {
      return res.status(403).json({ error: 'Cannot assign a role equal to or above your own' });
    }
    if (target.role === 'super_admin' && role !== 'super_admin' && isLastActiveSuperAdmin(target.id)) {
      return res.status(409).json({ error: 'Cannot demote the last active super_admin' });
    }
    updates.push('role = ?'); params.push(role);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(target.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as any;

  logAudit({ actorId: actor.sub, targetId: target.id, action: 'user_updated', metadata: { fields: Object.keys(req.body) }, req });
  res.json(publicUser(updated));
});

// ── POST /users/:id/disable ───────────────────────────────────────────────────

router.post('/:id/disable', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (actor.sub === target.id) return res.status(400).json({ error: 'Cannot disable your own account' });
  if (!canManage(actor.role as Role, target.role as Role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  if (target.role === 'super_admin' && isLastActiveSuperAdmin(target.id)) {
    return res.status(409).json({ error: 'Cannot disable the last active super_admin' });
  }

  db.prepare(`UPDATE users SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(target.id);
  logAudit({ actorId: actor.sub, targetId: target.id, action: 'user_disabled', req });
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as any;
  res.json(publicUser(updated));
});

// ── POST /users/:id/enable ────────────────────────────────────────────────────

router.post('/:id/enable', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canManage(actor.role as Role, target.role as Role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  db.prepare(`UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(target.id);
  logAudit({ actorId: actor.sub, targetId: target.id, action: 'user_enabled', req });
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as any;
  res.json(publicUser(updated));
});

// ── POST /users/:id/reset-password ───────────────────────────────────────────

router.post('/:id/reset-password', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!canManage(actor.role as Role, target.role as Role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, target.id);
  logAudit({ actorId: actor.sub, targetId: target.id, action: 'password_reset_issued', req });
  res.json({ ok: true });
});

// ── POST /users/change-password (self) ───────────────────────────────────────

router.post('/change-password', requireAuth, (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(actor.sub) as any;
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, actor.sub);
  logAudit({ actorId: actor.sub, action: 'password_changed', req });
  res.json({ ok: true });
});

export default router;
