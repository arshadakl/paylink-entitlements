import type { WorkerEnv } from '@/config/env';

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

/**
 * Google Drive API Service Interface.
 * Full Web Crypto RS256 JWT service-account implementation will be completed in Phase 6.
 */
export const googleDriveService = {
  /**
   * Checks if an email already possesses reader permission on a Google Drive folder.
   */
  async checkExistingPermission(
    _env: WorkerEnv,
    _folderId: string,
    _normalizedEmail: string
  ): Promise<string | null> {
    // Stubbed for Phase 5 queue integration; implemented in Phase 6
    return null;
  },

  /**
   * Creates a 'reader' (Viewer) permission on a Google Drive folder for the buyer's email.
   */
  async grantFolderReaderAccess(
    env: WorkerEnv,
    folderId: string,
    normalizedEmail: string
  ): Promise<GrantAccessResult> {
    // Check if permission already exists first (idempotent guard)
    const existingPermId = await this.checkExistingPermission(env, folderId, normalizedEmail);
    if (existingPermId) {
      return {
        permissionId: existingPermId,
        alreadyExisted: true,
      };
    }

    // Default mock permission ID for testing; Phase 6 implements the live Google API HTTP fetch
    return {
      permissionId: `perm_${crypto.randomUUID().slice(0, 8)}`,
      alreadyExisted: false,
    };
  },
};
