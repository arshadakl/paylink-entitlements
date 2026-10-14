import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { WorkerEnv } from '@/config/env';
import {
  computeHmacSha256Hex,
  timingSafeEqual,
} from '@/services/razorpay-verification';
import { base64UrlEncode } from '@/services/google-auth';

export interface AdminSessionPayload {
  username: string;
  exp: number; // Unix timestamp in seconds
  iat: number; // Unix timestamp in seconds
}

export const SESSION_COOKIE_NAME = 'paylink_session';
export const DEFAULT_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Creates a signed session token: base64url(payload).base64url(signature)
 */
export async function createSessionToken(
  username: string,
  secret: string,
  durationSeconds: number = DEFAULT_SESSION_DURATION_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    username,
    iat: now,
    exp: now + durationSeconds,
  };

  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadJson);
  const signatureHex = await computeHmacSha256Hex(encodedPayload, secret);

  return `${encodedPayload}.${signatureHex}`;
}

/**
 * Verifies a signed session token. Returns the payload if valid and unexpired.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  secret: string
): Promise<AdminSessionPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, receivedSignatureHex] = parts;
  if (!encodedPayload || !receivedSignatureHex) {
    return null;
  }

  // 1. Verify HMAC-SHA256 signature in constant time
  const expectedSignatureHex = await computeHmacSha256Hex(encodedPayload, secret);
  if (!timingSafeEqual(expectedSignatureHex, receivedSignatureHex.toLowerCase())) {
    return null;
  }

  // 2. Decode and parse payload
  try {
    const rawPayload = atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(rawPayload) as AdminSessionPayload;

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Hono Middleware requiring a valid admin session cookie.
 */
export async function adminAuthMiddleware(
  c: Context<{ Bindings: WorkerEnv; Variables: { adminUser: string } }>,
  next: Next
): Promise<Response | void> {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);

  if (!sessionToken) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to access admin resources',
        },
      },
      401
    );
  }

  const payload = await verifySessionToken(sessionToken, c.env.ADMIN_SESSION_SECRET);
  if (!payload) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session has expired or is invalid. Please log in again.',
        },
      },
      401
    );
  }

  // Attach authenticated user to context
  c.set('adminUser', payload.username);
  await next();
}
