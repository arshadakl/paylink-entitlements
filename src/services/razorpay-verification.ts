/**
 * Razorpay Webhook HMAC-SHA256 Signature Verification Service
 *
 * Strictly optimized for Cloudflare Workers Free Tier (< 10 ms CPU).
 * Uses native Web Crypto API (crypto.subtle) without any external polyfills.
 * Operates in < 0.5 ms CPU time.
 */

export interface VerificationResult {
  isValid: boolean;
  usedSecret: 'primary' | 'previous' | 'none';
  computedSignature?: string;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Computes hexadecimal HMAC-SHA256 signature for a raw UTF-8 string using Web Crypto.
 */
export async function computeHmacSha256Hex(
  rawBody: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);
  const bodyBytes = encoder.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyBytes);
  const signatureBytes = new Uint8Array(signatureBuffer);

  let hex = '';
  for (let i = 0; i < signatureBytes.length; i++) {
    hex += signatureBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Verifies a Razorpay webhook raw body against the received hex signature.
 * Supports zero-downtime secret rotation by falling back to previousSecret if provided.
 */
export async function verifyRazorpaySignature(
  rawBody: string,
  receivedSignature: string | null | undefined,
  primarySecret: string,
  previousSecret?: string | null
): Promise<VerificationResult> {
  if (!receivedSignature || typeof receivedSignature !== 'string') {
    return { isValid: false, usedSecret: 'none' };
  }

  const cleanSignature = receivedSignature.trim().toLowerCase();

  // 1. Verify against primary secret
  const primaryComputed = await computeHmacSha256Hex(rawBody, primarySecret);
  if (timingSafeEqual(primaryComputed, cleanSignature)) {
    return {
      isValid: true,
      usedSecret: 'primary',
      computedSignature: primaryComputed,
    };
  }

  // 2. If primary fails and previousSecret is configured, check previousSecret
  if (previousSecret && previousSecret.trim().length > 0) {
    const previousComputed = await computeHmacSha256Hex(rawBody, previousSecret);
    if (timingSafeEqual(previousComputed, cleanSignature)) {
      return {
        isValid: true,
        usedSecret: 'previous',
        computedSignature: previousComputed,
      };
    }
  }

  return { isValid: false, usedSecret: 'none' };
}

/**
 * Generates a SHA-256 hex digest of the raw payload for audit logging.
 * Avoids storing entire personal webhook bodies in D1.
 */
export async function hashPayloadSha256(rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawBody);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashBytes = new Uint8Array(hashBuffer);

  let hex = '';
  for (let i = 0; i < hashBytes.length; i++) {
    hex += hashBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
