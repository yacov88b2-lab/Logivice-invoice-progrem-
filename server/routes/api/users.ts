import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';
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

function publicInvite(row: any) {
  const { token_hash: _t, ...rest } = row;
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

// ── GET /users/invites ────────────────────────────────────────────────────────
// Must be before GET /:id to prevent 'invites' being treated as an id param

router.get('/invites', requireMinRole('admin'), (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM user_invites ORDER BY created_at DESC LIMIT 200`
  ).all();
  res.json((rows as any[]).map(publicInvite));
});

// ── GET /users/:id ────────────────────────────────────────────────────────────

router.get('/:id', requireMinRole('manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(row));
});

// ── POST /users (super_admin emergency direct-create) ─────────────────────────

router.post('/', requireMinRole('super_admin'), (req, res) => {
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
    logAudit({ actorId: actor.sub, targetId: newUser?.id, action: 'user_created', metadata: { email: normalizedEmail, role }, req });
    res.status(201).json(publicUser(newUser));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
});

// ── POST /users/invite ────────────────────────────────────────────────────────

router.post('/invite', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const { email, name, role = 'user' } = req.body;

  if (!email) return res.status(400).json({ error: 'email is required' });
  const normalizedEmail = normalizeEmail(String(email));
  if (!isAllowedEmail(normalizedEmail)) {
    return res.status(403).json({ error: 'Only @unilog.company emails are permitted' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!canManage(actor.role as Role, role as Role)) {
    return res.status(403).json({ error: 'You cannot invite a user with a role equal to or above your own' });
  }

  // Reject if active/invited user already exists
  const existingUser = db.prepare(
    "SELECT id FROM users WHERE LOWER(email) = ? AND status != 'disabled'"
  ).get(normalizedEmail);
  if (existingUser) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  // Reject if a valid pending invite already exists
  const existingPending = db.prepare(
    "SELECT id FROM user_invites WHERE email = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP"
  ).get(normalizedEmail);
  if (existingPending) {
    return res.status(409).json({ error: 'A pending invite already exists for this email. Use resend to reissue it.' });
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO user_invites (email, role, name, token_hash, invited_by_user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(normalizedEmail, role, name || null, tokenHash, actor.sub, expiresAt);

  const invite = db.prepare('SELECT * FROM user_invites WHERE token_hash = ?').get(tokenHash) as any;
  logAudit({ actorId: actor.sub, action: 'user_invited', metadata: { email: normalizedEmail, role }, req });

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  res.status(201).json({ invite: publicInvite(invite), inviteLink: `${appUrl}/register/accept?token=${token}` });
});

// ── POST /users/invites/:id/revoke ────────────────────────────────────────────

router.post('/invites/:id/revoke', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const invite = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(req.params.id) as any;
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending invites can be revoked' });
  }

  db.prepare(
    "UPDATE user_invites SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(invite.id);
  logAudit({ actorId: actor.sub, action: 'user_invite_revoked', metadata: { email: invite.email }, req });

  const updated = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(invite.id) as any;
  res.json(publicInvite(updated));
});

// ── POST /users/invites/:id/resend ────────────────────────────────────────────

router.post('/invites/:id/resend', requireMinRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user;
  const invite = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(req.params.id) as any;
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.status === 'accepted') {
    return res.status(400).json({ error: 'This invite has already been accepted' });
  }
  if (!canManage(actor.role as Role, invite.role as Role)) {
    return res.status(403).json({ error: 'Insufficient permissions to resend this invite' });
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  db.prepare(
    "UPDATE user_invites SET token_hash = ?, status = 'pending', expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(tokenHash, expiresAt, invite.id);

  logAudit({ actorId: actor.sub, action: 'user_invite_resent', metadata: { email: invite.email, role: invite.role }, req });

  const updated = db.prepare('SELECT * FROM user_invites WHERE id = ?').get(invite.id) as any;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  res.json({ invite: publicInvite(updated), inviteLink: `${appUrl}/register/accept?token=${token}` });
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
