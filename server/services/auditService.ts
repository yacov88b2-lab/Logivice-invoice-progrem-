import db from '../db';
import type { Request } from 'express';

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'two_factor_setup'
  | 'two_factor_verified'
  | 'two_factor_disabled'
  | 'backup_code_used'
  | 'password_changed'
  | 'user_created'
  | 'user_updated'
  | 'user_disabled'
  | 'user_enabled'
  | 'user_deleted'
  | 'role_changed'
  | 'password_reset_issued';

interface LogOptions {
  actorId?: string | null;
  targetId?: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  req?: Request;
}

const insert = db.prepare(
  `INSERT INTO user_audit_logs (actor_user_id, target_user_id, action, metadata, ip_address, user_agent)
   VALUES (?, ?, ?, ?, ?, ?)`
);

export function logAudit({ actorId, targetId, action, metadata, req }: LogOptions): void {
  try {
    const ip = req
      ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress || null
      : null;
    const ua = req ? (req.headers['user-agent'] || null) : null;
    insert.run(
      actorId ?? null,
      targetId ?? null,
      action,
      metadata ? JSON.stringify(metadata) : null,
      ip,
      ua
    );
  } catch {
    // never crash the request over an audit write failure
  }
}
