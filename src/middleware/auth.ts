import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendError } from '../utils/response';

// Extend Express's Request type to include our user info.
// After authenticate() runs, req.user will have { id, role }.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

// Middleware: Verify JWT token
// Extracts the token from "Authorization: Bearer <token>"
// If valid, attaches user info to req.user
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'UNAUTHORIZED', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch (err) {
    return sendError(res, 'UNAUTHORIZED', 401);
  }
}

// Middleware factory: Check user role
// Usage: authorize('owner') or authorize('customer')
// Must be used AFTER authenticate
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(res, 'FORBIDDEN', 403);
    }
    next();
  };
}
