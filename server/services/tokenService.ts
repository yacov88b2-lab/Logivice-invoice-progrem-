import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const ACCESS_TTL  = '8h';
const REFRESH_TTL = '7d';

export interface TokenPayload {
  sub: string;   // user id
  email: string;
  role: string;
  twoFactorVerified: boolean;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyToken(token: string): TokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, JWT_SECRET) as TokenPayload & { iat: number; exp: number };
}
