import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkerEnv } from '../../src/config/env';
import {
  base64UrlEncode,
  getGoogleAccessToken,
  clearTokenCache,
} from '../../src/services/google-auth';
import {
  googleDriveService,
  GoogleDriveError,
} from '../../src/services/google-drive-service';

describe('Google Drive Service & Web Crypto Authentication', () => {
  let mockEnv: WorkerEnv;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearTokenCache();

    mockEnv = {
      DB: {} as unknown as D1Database,
      GRANT_QUEUE: {} as unknown as Queue,
      RAZORPAY_WEBHOOK_SECRET: 'test_secret',
      GOOGLE_CLIENT_ID: 'mock_client_id',
      GOOGLE_CLIENT_SECRET: 'mock_client_secret',
      GOOGLE_REFRESH_TOKEN: 'mock_refresh_token',
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
    };
  });

  describe('base64UrlEncode', () => {
    it('should encode string into standard URL-safe base64 without padding', () => {
      const encoded = base64UrlEncode('{"alg":"RS256","typ":"JWT"}');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });
  });

  describe('getGoogleAccessToken & Caching', () => {
    it('should fetch OAuth access token and cache it for subsequent requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock_token_123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      } as Response);

      const token1 = await getGoogleAccessToken(mockEnv);
      expect(token1).toBe('mock_token_123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Subsequent call should hit in-memory cache without calling fetch
      const token2 = await getGoogleAccessToken(mockEnv);
      expect(token2).toBe('mock_token_123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // After clearing cache, fetch should be called again
      clearTokenCache();
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock_token_456',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      } as Response);

      const token3 = await getGoogleAccessToken(mockEnv);
      expect(token3).toBe('mock_token_456');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should throw GoogleDriveError if no credentials are configured', async () => {
      const emptyEnv = { ...mockEnv };
      delete emptyEnv.GOOGLE_CLIENT_ID;
      delete emptyEnv.GOOGLE_REFRESH_TOKEN;
      await expect(getGoogleAccessToken(emptyEnv)).rejects.toThrow(GoogleDriveError);
    });
  });

  describe('extractFolderId', () => {
    const validFolderId = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';

    it('should extract folder ID from raw ID string', () => {
      expect(googleDriveService.extractFolderId(validFolderId)).toBe(validFolderId);
    });

    it('should extract folder ID from standard Google Drive URL', () => {
      const url = `https://drive.google.com/drive/folders/${validFolderId}`;
      expect(googleDriveService.extractFolderId(url)).toBe(validFolderId);
    });

    it('should extract folder ID from Google Drive URL with user index and query params', () => {
      const url = `https://drive.google.com/drive/u/1/folders/${validFolderId}?usp=sharing&resourcekey=0-xyz`;
      expect(googleDriveService.extractFolderId(url)).toBe(validFolderId);
    });

    it('should throw GoogleDriveError for invalid folder format', () => {
      expect(() => googleDriveService.extractFolderId('short_id')).toThrow(GoogleDriveError);
      expect(() => googleDriveService.extractFolderId('https://google.com/search?q=test')).toThrow(
        GoogleDriveError
      );
    });
  });

  describe('validateFolder', () => {
    const folderId = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';

    it('should validate valid active Google Drive folder successfully', async () => {
      vi.spyOn(globalThis, 'fetch')
        // Mock token fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        // Mock folder metadata fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: folderId,
            name: 'Excel Course Materials',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
            capabilities: { canShare: true },
          }),
        } as Response);

      const metadata = await googleDriveService.validateFolder(mockEnv, folderId);
      expect(metadata.id).toBe(folderId);
      expect(metadata.name).toBe('Excel Course Materials');
      expect(metadata.canShare).toBe(true);
    });

    it('should throw NOT_A_FOLDER error if target is a file or spreadsheet', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: folderId,
            name: 'Financial Model.xlsx',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            trashed: false,
          }),
        } as Response);

      await expect(googleDriveService.validateFolder(mockEnv, folderId)).rejects.toThrow(
        /not a Google Drive folder/
      );
    });

    it('should throw FOLDER_TRASHED error if folder is in the trash', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: folderId,
            name: 'Old Course',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: true,
          }),
        } as Response);

      await expect(googleDriveService.validateFolder(mockEnv, folderId)).rejects.toThrow(
        /in the trash/
      );
    });

    it('should throw FOLDER_NOT_FOUND error on 404 response', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'File not found',
        } as Response);

      await expect(googleDriveService.validateFolder(mockEnv, folderId)).rejects.toThrow(
        GoogleDriveError
      );
    });
  });

  describe('checkExistingPermission', () => {
    const folderId = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';

    it('should return permission ID when user already has reader role', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permissions: [
              { id: 'perm_owner', emailAddress: 'owner@example.com', role: 'owner' },
              { id: 'perm_buyer_123', emailAddress: 'buyer@example.com', role: 'reader' },
            ],
          }),
        } as Response);

      const permId = await googleDriveService.checkExistingPermission(
        mockEnv,
        folderId,
        'Buyer@Example.com'
      );
      expect(permId).toBe('perm_buyer_123');
    });

    it('should return null when user is not present in folder permissions', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            permissions: [
              { id: 'perm_owner', emailAddress: 'owner@example.com', role: 'owner' },
            ],
          }),
        } as Response);

      const permId = await googleDriveService.checkExistingPermission(
        mockEnv,
        folderId,
        'new_buyer@example.com'
      );
      expect(permId).toBeNull();
    });
  });

  describe('grantFolderReaderAccess', () => {
    const folderId = '1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';
    const email = 'student@example.com';

    it('should return alreadyExisted: true without calling POST if permission exists', async () => {
      vi.spyOn(googleDriveService, 'checkExistingPermission').mockResolvedValue('perm_existing_789');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await googleDriveService.grantFolderReaderAccess(mockEnv, folderId, email);

      expect(result.permissionId).toBe('perm_existing_789');
      expect(result.alreadyExisted).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should create reader permission and return permissionId when permission is new', async () => {
      vi.spyOn(googleDriveService, 'checkExistingPermission').mockResolvedValue(null);

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'perm_new_student_456',
            role: 'reader',
            type: 'user',
            emailAddress: email,
          }),
        } as Response);

      const result = await googleDriveService.grantFolderReaderAccess(mockEnv, folderId, email);

      expect(result.permissionId).toBe('perm_new_student_456');
      expect(result.alreadyExisted).toBe(false);
    });

    it('should classify 400 invalid sharing as permanent error (isTransient: false)', async () => {
      vi.spyOn(googleDriveService, 'checkExistingPermission').mockResolvedValue(null);

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                message: 'Invalid recipient email address',
                errors: [{ reason: 'invalidSharingRequest' }],
              },
            }),
        } as Response);

      try {
        await googleDriveService.grantFolderReaderAccess(mockEnv, folderId, 'invalid@domain');
        expect.unreachable('Should have thrown GoogleDriveError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GoogleDriveError);
        const driveErr = err as GoogleDriveError;
        expect(driveErr.isTransient).toBe(false);
        expect(driveErr.code).toBe('INVALID_RECIPIENT_OR_RESTRICTED_DOMAIN');
      }
    });

    it('should classify 429 rate limit as transient error (isTransient: true)', async () => {
      vi.spyOn(googleDriveService, 'checkExistingPermission').mockResolvedValue(null);

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'Rate Limit Exceeded',
        } as Response);

      try {
        await googleDriveService.grantFolderReaderAccess(mockEnv, folderId, email);
        expect.unreachable('Should have thrown GoogleDriveError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(GoogleDriveError);
        const driveErr = err as GoogleDriveError;
        expect(driveErr.isTransient).toBe(true);
        expect(driveErr.code).toBe('RATE_LIMITED');
      }
    });
  });
});
