import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';

export type AuthUser = { id: number; email: string; role: UserRole };
export type AuthRequest = Request & { auth?: AuthUser };

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return value;
};

export const createToken = (user: AuthUser) => jwt.sign(user, secret(), { expiresIn: '8h' });

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Authentication required' });
  try {
    req.auth = jwt.verify(header.slice(7), secret()) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ message: 'Session is invalid or expired' });
  }
}

export const requireRole = (...roles: UserRole[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ message: 'You do not have permission to access this resource' });
  next();
};
