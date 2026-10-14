import type { Context, Next } from 'hono';

/**
 * Global Security Headers Middleware
 */
export async function securityHeadersMiddleware(c: Context, next: Next): Promise<void> {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '1; mode=block');
}
