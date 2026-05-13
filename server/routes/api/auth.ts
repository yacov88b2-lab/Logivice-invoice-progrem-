import express from 'express';
import bcrypt from 'bcryptjs';
import { verifySync } from 'otplib';
import db from '../../db';
import { signAccessToken, verifyToken } from '../../services/tokenService';
import { isAllowedEmail, normalizeEmail, getDomain } from '../../services/emailDomain';
import { logAudit } from '../../services/auditService';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth';
import { loginRateLimit, twoFactorRateLimit } from '../../middleware/rateLimit';

const router = express.Router();

// ── POST /auth/login ──────────────────────────────────────────────────────────

router.post('/login', loginRateLimit, (req, res) => {
  const { email, password } = req.body;

  const INVALID_CREDENTIALS = 'Invalid email or password';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = normalizeEmail(String(email));

  // Domain check is silent — same error as wrong credentials to avoid leaking policy
  if (!isAllowedEmail(normalizedEmail)) {
    logAudit({ action: 'login_failed', metadata: { domain: getDomain(normalizedEmail), domainAllowed: false }, req });
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit({ action: 'login_failed', metadata: { domain: getDomain(normalizedEmail), domainAllowed: true }, req });
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'Your account has been disabled. Contact an administrator.' });
  }

  // If 2FA is enabled, issue a limited pre-2FA token
  if (user.two_factor_enabled) {
    const preToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      twoFactorVerified: false,
    });
    return res.json({ requiresTwoFactor: true, preToken });
  }

  // Full login
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logAudit({ actorId: user.id, action: 'login_success', req });

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    twoFactorVerified: true,
  });
  return res.json({ token, user: publicUser(user) });
});

// ── POST /auth/2fa-verify ─────────────────────────────────────────────────────

router.post('/2fa-verify', twoFactorRateLimit, (req, res) => {
  const { preToken, code } = req.body;
  if (!preToken || !code) {
    return res.status(400).json({ error: 'preToken and code are required' });
  }

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(preToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (payload.twoFactorVerified) {
    return res.status(400).json({ error: 'Token is not a pre-2FA token' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as any;
  if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
    return res.status(400).json({ error: 'Two-factor authentication not configured' });
  }

  // Try TOTP code
  const totpResult = verifySync({ token: String(code).replace(/\s/g, ''), secret: user.two_factor_secret });
  const totpValid = totpResult && totpResult.valid;

  if (!totpValid) {
    // Try backup codes
    if (!user.backup_codes_hash) {
      logAudit({ actorId: user.id, action: 'two_factor_verified', metadata: { success: false }, req });
      return res.status(401).json({ error: 'Invalid authentication code' });
    }
    const backupCodes: string[] = JSON.parse(user.backup_codes_hash);
    const submittedCode = String(code).replace(/[-\s]/g, '').toLowerCase();
    const matchIndex = backupCodes.findIndex(c => bcrypt.compareSync(submittedCode, c));
    if (matchIndex === -1) {
      logAudit({ actorId: user.id, action: 'two_factor_verified', metadata: { success: false }, req });
      return res.status(401).json({ error: 'Invalid authentication code' });
    }
    // Consume the backup code
    backupCodes.splice(matchIndex, 1);
    db.prepare('UPDATE users SET backup_codes_hash = ? WHERE id = ?').run(JSON.stringify(backupCodes), user.id);
    logAudit({ actorId: user.id, action: 'backup_code_used', req });
  }

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logAudit({ actorId: user.id, action: 'two_factor_verified', metadata: { success: true }, req });

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    twoFactorVerified: true,
  });
  return res.json({ token, user: publicUser(user) });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  const { sub } = (req as AuthenticatedRequest).user;
  logAudit({ actorId: sub, action: 'logout', req });
  // JWT is stateless; client deletes the token
  res.json({ ok: true });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function publicUser(row: any) {
  const { password_hash: _p, two_factor_secret: _s, backup_codes_hash: _b, ...rest } = row;
  return rest;
}

export default router;
