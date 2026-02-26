

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { signupSchema, loginSchema } from '../validators/schemas';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

// ─── POST /api/auth/signup ─────────────────────────────────
router.post('/signup', async (req: Request, res: Response) => {
  try {
    // Step 1: Validate request body with Zod
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    const { name, email, password, role, phone } = parsed.data;

    // Step 2: Check if email already exists
    // With Prisma: prisma.user.findUnique({ where: { email } })
    // Returns null if not found, or the user object if found
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return sendError(res, 'EMAIL_ALREADY_EXISTS', 400);
    }

    // Step 3: Hash password (10 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 4: Create user with Prisma
    // Notice how clean this is compared to raw SQL!
    const id = `usr_${uuidv4().replace(/-/g, '').substring(0, 10)}`;
    const user = await prisma.user.create({
      data: {
        id,
        name,
        email,
        password: hashedPassword,
        role,
        phone: phone || null,
      },
    });

    // Step 5: Return (no password in response!)
    return sendSuccess(res, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }, 201);
  } catch (err) {
    console.error('Signup error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

// ─── POST /api/auth/login ──────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    // Step 1: Validate
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 'INVALID_REQUEST', 400);
    }

    const { email, password } = parsed.data;

    // Step 2: Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return sendError(res, 'INVALID_CREDENTIALS', 401);
    }

    // Step 3: Compare password with stored hash
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return sendError(res, 'INVALID_CREDENTIALS', 401);
    }

    // Step 4: Sign JWT token (contains user id + role)
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Step 5: Return token + user info
    return sendSuccess(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return sendError(res, 'INTERNAL_ERROR', 500);
  }
});

export default router;
