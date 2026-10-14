import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { WorkerEnv } from '@/config/env';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_DURATION_SECONDS,
} from '@/middleware/admin-auth';
import { timingSafeEqual } from '@/services/razorpay-verification';

export const authRouter = new Hono<{ Bindings: WorkerEnv }>();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload',
        },
      },
      400
    );
  }

  const parseResult = loginSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Username and password are required',
        },
      },
      400
    );
  }

  const { username, password } = parseResult.data;
  const configuredUser = c.env.ADMIN_USERNAME || 'admin';
  const configuredPassword = c.env.ADMIN_PASSWORD || 'change_me_in_production';

  // Constant-time check for username and password to prevent timing attacks
  const isUsernameMatch = timingSafeEqual(username, configuredUser);
  const isPasswordMatch = timingSafeEqual(password, configuredPassword);

  if (!isUsernameMatch || !isPasswordMatch) {
    return c.json(
      {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Incorrect username or password',
        },
      },
      401
    );
  }

  // Create signed session token
  const token = await createSessionToken(
    configuredUser,
    c.env.ADMIN_SESSION_SECRET,
    DEFAULT_SESSION_DURATION_SECONDS
  );

  // Set secure HttpOnly cookie
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: DEFAULT_SESSION_DURATION_SECONDS,
  });

  return c.json({
    success: true,
    username: configuredUser,
  });
});

authRouter.post('/logout', async (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    secure: true,
    sameSite: 'Strict',
  });

  return c.json({
    success: true,
    message: 'Logged out successfully',
  });
});

authRouter.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ authenticated: false });
  }

  const session = await verifySessionToken(token, c.env.ADMIN_SESSION_SECRET);
  if (!session) {
    return c.json({ authenticated: false });
  }

  return c.json({
    authenticated: true,
    username: session.username,
  });
});
