import express from 'express';
import bcrypt from 'bcryptjs';
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import db from '../../db';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';

const router = express.Router();

router.use(requireAuth);

// ── POST /security/2fa/setup ──────────────────────────────────────────────────
// Generates a new TOTP secret + QR code. Does NOT enable 2FA yet.

router.post('/2fa/setup', (req, res) => {
  const { sub, email } = (req as AuthenticatedRequest).user;

  const secret = generateSecret();
  const otpAuthUrl = generateURI({
    label: email,
    secret,
    issuer: 'Logivice'
  });

  // Store pending secret (not yet confirmed)
  db.prepare('UPDATE users SET two_factor_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(secret, sub);

  qrcode.toDataURL(otpAuthUrl, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'Failed to generate QR code' });
    res.json({ secret, qrCodeDataUrl: dataUrl });
  });
});

// ── POST /security/2fa/confirm ────────────────────────────────────────────────
// Verifies the first TOTP code and activates 2FA + generates backup codes.

router.post('/2fa/confirm', (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  const { code } = req.body;

  if (!code) return res.status(400).json({ error: 'code is required' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub) as any;
  if (!user?.two_factor_secret) {
    return res.status(400).json({ error: 'Run /2fa/setup first' });
  }
  if (user.two_factor_enabled) {
    return res.status(400).json({ error: '2FA is already enabled' });
  }

  const result = verifySync({ token: String(code).replace(/\s/g, ''), secret: user.two_factor_secret });
  const valid = result && result.valid;
  if (!valid) return res.status(400).json({ error: 'Invalid code — check your authenticator app' });

  // Generate 8 backup codes
  const plainCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(5).toString('hex') // 10-char hex
  );
  const hashedCodes = plainCodes.map(c => bcrypt.hashSync(c, 10));

  db.prepare(
    'UPDATE users SET two_factor_enabled = 1, backup_codes_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(hashedCodes), sub);

  logAudit({ actorId: sub, action: 'two_factor_setup', req });

  // Return plain codes once — user must save them
  res.json({ backupCodes: plainCodes });
});

// ── POST /security/2fa/disable ────────────────────────────────────────────────

router.post('/2fa/disable', (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  const { password } = req.body;

  if (!password) return res.status(400).json({ error: 'password is required to disable 2FA' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  if (!user.two_factor_enabled) {
    return res.status(400).json({ error: '2FA is not enabled' });
  }

  db.prepare(
    'UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, backup_codes_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(sub);

  logAudit({ actorId: sub, action: 'two_factor_disabled', req });
  res.json({ ok: true });
});

// ── POST /security/2fa/backup-codes/regenerate ────────────────────────────────

router.post('/2fa/backup-codes/regenerate', (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  const { password } = req.body;

  if (!password) return res.status(400).json({ error: 'password is required' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  if (!user.two_factor_enabled) {
    return res.status(400).json({ error: '2FA must be enabled to regenerate backup codes' });
  }

  const plainCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  const hashedCodes = plainCodes.map(c => bcrypt.hashSync(c, 10));

  db.prepare(
    'UPDATE users SET backup_codes_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(hashedCodes), sub);

  res.json({ backupCodes: plainCodes });
});

// ── GET /security/2fa/status ──────────────────────────────────────────────────

router.get('/2fa/status', (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  const user = db.prepare('SELECT two_factor_enabled, backup_codes_hash FROM users WHERE id = ?').get(sub) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  const codesRemaining = user.backup_codes_hash
    ? (JSON.parse(user.backup_codes_hash) as string[]).length
    : 0;
  res.json({ enabled: Boolean(user.two_factor_enabled), backupCodesRemaining: codesRemaining });
});

export default router;
