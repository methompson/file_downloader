import { isEnumValueGenerator } from '@metools/tcheck';

/**
 * DownloadStatus represents the various states a download operation
 * can be in. The following statuses are defined:
 * - Pending: The download is queued and waiting to start.
 * - Paused: The download has been started and has been paused by the user.
 * - Downloading: The download is currently in progress.
 * - Completed: The download has finished successfully.
 * - Failed: The download has failed due to an error.
 */
export enum DownloadStatus {
  Pending = 'pending',
  Paused = 'paused',
  Downloading = 'downloading',
  Completed = 'completed',
  Failed = 'failed',
}

export const isDownloadStatus = isEnumValueGenerator(DownloadStatus);
