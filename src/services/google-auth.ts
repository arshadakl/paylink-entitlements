import type { WorkerEnv } from '@/config/env';
import { GoogleDriveError } from './google-drive-service';

export interface CachedGoogleToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedGoogleToken | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let cachedPrivateKeyPem: string | null = null;

export function clearTokenCache(): void {
  cachedToken = null;
  cachedCryptoKey = null;
  cachedPrivateKeyPem = null;
}

/**
 * Encodes an ArrayBuffer or UTF-8 string into standard Base64Url format (RFC 7515).
 */
export function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let base64 = '';
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  } else {
    const bytes = new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parses a standard PKCS#8 PEM string and imports an RSASSA-PKCS1-v1_5 CryptoKey using Web Crypto.
 */
export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  const cleanPem = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binaryString = atob(cleanPem);
  const keyBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    keyBytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
}

/**
 * Creates and cryptographically signs a Google Service Account JWT assertion using native Web Crypto RS256.
 */
export async function createSignedServiceAccountJwt(
  clientEmail: string,
  privateKeyPem: string
): Promise<string> {
  // Cache the imported CryptoKey in memory to avoid repeated key import CPU overhead
  if (!cachedCryptoKey || cachedPrivateKeyPem !== privateKeyPem) {
    cachedCryptoKey = await importPrivateKeyFromPem(privateKeyPem);
    cachedPrivateKeyPem = privateKeyPem;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedToken = `${encodedHeader}.${encodedClaimSet}`;

  const dataToSign = new TextEncoder().encode(unsignedToken);
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cachedCryptoKey,
    dataToSign
  );

  const encodedSignature = base64UrlEncode(signatureBuffer);
  return `${unsignedToken}.${encodedSignature}`;
}

/**
 * Obtains a valid Google OAuth access token.
 * Leverages in-memory token caching with a 5-minute safety buffer.
 */
export async function getGoogleAccessToken(env: WorkerEnv): Promise<string> {
  const nowMs = Date.now();
  // 5-minute safety buffer
  if (cachedToken && nowMs < cachedToken.expiresAtMs - 5 * 60 * 1000) {
    return cachedToken.accessToken;
  }

  // 1. Service Account authentication flow (Preferred)
  if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    try {
      const assertion = await createSignedServiceAccountJwt(
        env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
      );

      const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleAuth] Token exchange failed:', response.status, errorText);
        throw new GoogleDriveError(
          'Failed to authenticate service account with Google OAuth2',
          'GOOGLE_AUTH_FAILED',
          response.status >= 500,
          response.status
        );
      }

      const tokenData = (await response.json()) as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      cachedToken = {
        accessToken: tokenData.access_token,
        expiresAtMs: nowMs + tokenData.expires_in * 1000,
      };

      return tokenData.access_token;
    } catch (err: unknown) {
      if (err instanceof GoogleDriveError) throw err;
      throw new GoogleDriveError(
        'Unexpected error obtaining Google service account token',
        'GOOGLE_AUTH_ERROR',
        true
      );
    }
  }

  // 2. OAuth 2.0 refresh token fallback flow
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
    try {
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      });

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleAuth] OAuth refresh failed:', response.status, errorText);
        throw new GoogleDriveError(
          'Failed to refresh Google OAuth token',
          'GOOGLE_OAUTH_REFRESH_FAILED',
          response.status >= 500,
          response.status
        );
      }

      const tokenData = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };

      cachedToken = {
        accessToken: tokenData.access_token,
        expiresAtMs: nowMs + tokenData.expires_in * 1000,
      };

      return tokenData.access_token;
    } catch (err: unknown) {
      if (err instanceof GoogleDriveError) throw err;
      throw new GoogleDriveError(
        'Unexpected error refreshing Google OAuth token',
        'GOOGLE_OAUTH_ERROR',
        true
      );
    }
  }

  throw new GoogleDriveError(
    'No Google Drive credentials configured (Service Account or OAuth required)',
    'MISSING_GOOGLE_CREDENTIALS',
    false
  );
}
