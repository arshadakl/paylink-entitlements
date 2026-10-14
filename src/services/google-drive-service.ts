import type { WorkerEnv } from '@/config/env';
import { getGoogleAccessToken } from './google-auth';

export class GoogleDriveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isTransient: boolean = false,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GoogleDriveError';
  }
}

export interface GrantAccessResult {
  permissionId: string;
  alreadyExisted: boolean;
}

export interface FolderMetadata {
  id: string;
  name: string;
  mimeType: string;
  canShare: boolean;
}

export const googleDriveService = {
  /**
   * Extracts a Google Drive Folder ID from a raw folder ID or full sharing URL.
   */
  extractFolderId(input: string): string {
    const trimmed = input.trim();
    // Matches: https://drive.google.com/drive/folders/1abcXYZ_123?usp=sharing
    // or https://drive.google.com/drive/u/0/folders/1abcXYZ_123
    const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }

    // Direct folder ID regex check (Google IDs are generally 25-45 characters alphanumeric)
    if (/^[a-zA-Z0-9_-]{25,60}$/.test(trimmed)) {
      return trimmed;
    }

    throw new GoogleDriveError(
      'Invalid Google Drive folder ID or URL format',
      'INVALID_FOLDER_ID_FORMAT',
      false,
      400
    );
  },

  /**
   * Validates that the provided Google Drive resource exists, is a folder, is not trashed,
   * and that the authenticated service account possesses permission to share it.
   */
  async validateFolder(env: WorkerEnv, folderInput: string): Promise<FolderMetadata> {
    const folderId = this.extractFolderId(folderInput);
    const token = await getGoogleAccessToken(env);

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}`);
    url.searchParams.set('fields', 'id,name,mimeType,trashed,capabilities(canShare,canAddChildren)');
    url.searchParams.set('supportsAllDrives', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GoogleDriveError(
          `Google Drive folder ${folderId} was not found or is inaccessible. Ensure it is shared with the service account.`,
          'FOLDER_NOT_FOUND',
          false,
          404
        );
      }
      if (response.status === 403) {
        throw new GoogleDriveError(
          `Access to Google Drive folder ${folderId} is forbidden. Ensure the service account has permission.`,
          'FOLDER_ACCESS_FORBIDDEN',
          false,
          403
        );
      }
      throw new GoogleDriveError(
        `Failed to inspect Google Drive folder (HTTP ${response.status})`,
        'FOLDER_INSPECTION_FAILED',
        response.status >= 500,
        response.status
      );
    }

    const data = (await response.json()) as {
      id: string;
      name: string;
      mimeType: string;
      trashed?: boolean;
      capabilities?: {
        canShare?: boolean;
        canAddChildren?: boolean;
      };
    };

    if (data.trashed) {
      throw new GoogleDriveError(
        `Google Drive folder "${data.name}" (${folderId}) is currently in the trash.`,
        'FOLDER_TRASHED',
        false,
        400
      );
    }

    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      throw new GoogleDriveError(
        `Target "${data.name}" is a file (${data.mimeType}), not a Google Drive folder.`,
        'NOT_A_FOLDER',
        false,
        400
      );
    }

    const canShare = Boolean(data.capabilities?.canShare ?? data.capabilities?.canAddChildren ?? true);

    return {
      id: data.id,
      name: data.name,
      mimeType: data.mimeType,
      canShare,
    };
  },

  /**
   * Checks if an email already possesses reader, writer, or owner permission on a Google Drive folder.
   */
  async checkExistingPermission(
    env: WorkerEnv,
    folderId: string,
    normalizedEmail: string
  ): Promise<string | null> {
    const token = await getGoogleAccessToken(env);

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`);
    url.searchParams.set('fields', 'permissions(id,emailAddress,role,type)');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('supportsAllDrives', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GoogleDriveError(`Folder ${folderId} not found`, 'FOLDER_NOT_FOUND', false, 404);
      }
      if (response.status === 403) {
        throw new GoogleDriveError('Insufficient permissions to list folder permissions', 'PERMISSION_DENIED', false, 403);
      }
      throw new GoogleDriveError(
        `Failed to list permissions for folder ${folderId}`,
        'PERMISSION_LIST_FAILED',
        response.status >= 500,
        response.status
      );
    }

    const data = (await response.json()) as {
      permissions?: Array<{
        id: string;
        emailAddress?: string;
        role?: string;
        type?: string;
      }>;
    };

    if (!data.permissions || data.permissions.length === 0) {
      return null;
    }

    const targetEmail = normalizedEmail.toLowerCase();
    const existing = data.permissions.find(
      (p) =>
        p.emailAddress &&
        p.emailAddress.toLowerCase() === targetEmail &&
        ['reader', 'writer', 'owner', 'fileOrganizer', 'organizer'].includes(p.role ?? '')
    );

    return existing ? existing.id : null;
  },

  /**
   * Idempotently creates a 'reader' (Viewer) permission on a Google Drive folder for the buyer's email.
   */
  async grantFolderReaderAccess(
    env: WorkerEnv,
    folderId: string,
    normalizedEmail: string,
    sendNotification: boolean = true
  ): Promise<GrantAccessResult> {
    // 1. Check existing permission first to prevent duplicate grants
    const existingPermId = await this.checkExistingPermission(env, folderId, normalizedEmail);
    if (existingPermId) {
      return {
        permissionId: existingPermId,
        alreadyExisted: true,
      };
    }

    const token = await getGoogleAccessToken(env);

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`);
    url.searchParams.set('sendNotificationEmail', String(sendNotification));
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('fields', 'id,role,type,emailAddress');

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'user',
        emailAddress: normalizedEmail,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorReason = '';
      try {
        const errorJson = JSON.parse(errorText) as {
          error?: {
            message?: string;
            errors?: Array<{ reason?: string; message?: string }>;
          };
        };
        errorReason = errorJson.error?.errors?.[0]?.reason || errorJson.error?.message || '';
      } catch {
        errorReason = errorText;
      }

      console.error(`[GoogleDriveService] Permission grant failed (${response.status}):`, errorReason);

      // 400 Bad Request: Typically an invalid email address format or a domain that forbids external sharing
      if (response.status === 400) {
        throw new GoogleDriveError(
          `Google rejected sharing with ${normalizedEmail}: ${errorReason}`,
          'INVALID_RECIPIENT_OR_RESTRICTED_DOMAIN',
          false,
          400
        );
      }

      // 404 Not Found: Folder does not exist
      if (response.status === 404) {
        throw new GoogleDriveError(
          `Google Drive folder ${folderId} does not exist`,
          'FOLDER_NOT_FOUND',
          false,
          404
        );
      }

      // 403 Forbidden: Insufficient permissions or Google sharing quota exceeded
      if (response.status === 403) {
        const isQuota =
          errorReason.includes('userRateLimitExceeded') ||
          errorReason.includes('rateLimitExceeded') ||
          errorReason.includes('dailyLimitExceeded');

        throw new GoogleDriveError(
          `Google Drive permission creation forbidden: ${errorReason}`,
          isQuota ? 'RATE_LIMITED' : 'INSUFFICIENT_SHARING_PERMISSIONS',
          isQuota,
          403
        );
      }

      // 429 Too Many Requests: Transient rate limit
      if (response.status === 429) {
        throw new GoogleDriveError('Google Drive API rate limit exceeded', 'RATE_LIMITED', true, 429);
      }

      // 5xx Server Error: Google transient internal error
      throw new GoogleDriveError(
        `Google Drive API returned temporary error (${response.status})`,
        'GOOGLE_DRIVE_UNAVAILABLE',
        response.status >= 500,
        response.status
      );
    }

    const data = (await response.json()) as { id: string };

    return {
      permissionId: data.id,
      alreadyExisted: false,
    };
  },
};
