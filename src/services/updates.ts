import * as Updates from 'expo-updates';

export interface AppUpdateState {
  isEnabled: boolean;
  channel: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
}

export type UpdateCheckResultStatus =
  | 'disabled' // Running in __DEV__ or expo-updates not enabled
  | 'no_update' // Server responded: up to date
  | 'update_ready' // New update downloaded and ready to apply
  | 'timeout' // Network check timed out
  | 'error'; // Network error or server error

export interface UpdateCheckOutcome {
  status: UpdateCheckResultStatus;
  message: string;
  updateId?: string;
  error?: string;
}

// Session guards to prevent repeated network spam or reload loops
let hasCheckedThisSession = false;
let isCheckInProgress = false;

/**
 * Returns current build runtime and update metadata.
 */
export function getAppUpdateInfo(): AppUpdateState {
  return {
    isEnabled: Updates.isEnabled,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  };
}

/**
 * Safely checks for an available EAS Update and downloads it in the background.
 *
 * Guarantees:
 * - Never blocks UI or startup (asynchronous).
 * - Bounded by an 8-second network timeout.
 * - Single-flight: prevents concurrent duplicate checks.
 * - Gracefully handles offline mode and errors.
 * - Does NOT trigger reloadAsync() automatically (safe from interrupting user actions).
 */
export async function checkAndDownloadUpdateInBackground(
  options: { force?: boolean } = {}
): Promise<UpdateCheckOutcome> {
  // 1. Guard against checking in local development or Expo Go
  if (__DEV__ || !Updates.isEnabled) {
    return {
      status: 'disabled',
      message: 'Updates disabled in development mode or Expo Go.',
    };
  }

  // 2. Prevent duplicate checks in the same session unless forced by user tap
  if (isCheckInProgress) {
    return {
      status: 'no_update',
      message: 'Update check already in progress.',
    };
  }

  if (hasCheckedThisSession && !options.force) {
    return {
      status: 'no_update',
      message: 'Already checked for updates in this session.',
    };
  }

  isCheckInProgress = true;

  try {
    // 3. Network check bounded by 8-second timeout
    const checkPromise = Updates.checkForUpdateAsync();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Update check timed out after 8s')), 8000)
    );

    const checkResult = await Promise.race([checkPromise, timeoutPromise]);
    hasCheckedThisSession = true;

    if (!checkResult.isAvailable) {
      return {
        status: 'no_update',
        message: 'NearU is up to date.',
      };
    }

    // 4. Update available: Download in background with 20-second timeout
    const fetchPromise = Updates.fetchUpdateAsync();
    const fetchTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Update download timed out after 20s')), 20000)
    );

    const fetchResult = await Promise.race([fetchPromise, fetchTimeout]);

    if (fetchResult.isNew) {
      const manifestId = (fetchResult.manifest as any)?.id || Updates.updateId || 'new';
      return {
        status: 'update_ready',
        message: 'New update downloaded successfully and ready to apply.',
        updateId: manifestId,
      };
    }

    return {
      status: 'no_update',
      message: 'NearU is up to date.',
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (errorMsg.includes('timed out')) {
      return {
        status: 'timeout',
        message: 'Update check timed out. Preserving current version.',
        error: errorMsg,
      };
    }

    return {
      status: 'error',
      message: 'Could not check for updates. Operating in offline mode.',
      error: errorMsg,
    };
  } finally {
    isCheckInProgress = false;
  }
}

/**
 * Safely applies a downloaded update by reloading the JS runtime.
 * Should only be called when the user explicitly confirms or on next cold launch.
 */
export async function applyUpdateNow(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) {
    return false;
  }

  try {
    await Updates.reloadAsync();
    return true;
  } catch (err) {
    console.warn('[NearU Updates] Failed to reload update:', err);
    return false;
  }
}
