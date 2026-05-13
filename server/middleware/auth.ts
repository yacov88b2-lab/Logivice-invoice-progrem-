import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type TokenPayload } from '../services/tokenService';

export interface AuthenticatedRequest extends Request {
  user: TokenPayload & { iat: number; exp: number };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    if (!payload.twoFactorVerified) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

type Role = 'super_admin' | 'admin' | 'manager' | 'user' | 'viewer';

const ROLE_RANK: Record<Role, number> = {
  super_admin: 5,
  admin: 4,
  manager: 3,
  user: 2,
  viewer: 1,
};

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(user.role as Role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function requireMinRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const userRank  = ROLE_RANK[user.role as Role] ?? 0;
    const minRank   = ROLE_RANK[minRole];
    if (userRank < minRank) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
