import { DownloadOperation } from '@/models/download_operation';
import { ActiveDownload } from '@/models/active_download';
import { NoActiveDownloadError, NoDownloadOperationError } from './errors';

/**
 * Manages download operations and active downloads.
 * This is a singleton class.
 * We use a class structure to encapsulate the download management
 * state and behavior.
 *
 * This class should not be exported directly.
 */
class DownloadManager {
  private _downloadOperations: Record<string, DownloadOperation> = {};
  private _activeDownloads: Record<string, ActiveDownload> = {};

  /**
   * Adds an opoeration to the download manager
   */
  addDownloadOperation(downloadOp: DownloadOperation): void {
    this._downloadOperations[downloadOp.id] = downloadOp;
  }

  get downloadOperations(): Record<string, DownloadOperation> {
    return { ...this._downloadOperations };
  }

  get activeDownloads(): Record<string, ActiveDownload> {
    return { ...this._activeDownloads };
  }

  /**
   * Starts the process of downloading a file
   */
  async startDownload(downloadId: string): Promise<DownloadOperation> {
    // Gets the download op.
    const downloadOp = this._downloadOperations[downloadId];

    // If it doesn't exist, throw an error.
    if (!downloadOp) {
      throw new NoDownloadOperationError('Invalid download operation ID');
    }

    // We create an active download from a download op. The active download class
    // will handle the actual downloading of the file and updating the download op.
    const activeDownload = await ActiveDownload.newActiveDownload(downloadOp);
    activeDownload.on('finishedDownload', () => {
      this.finishDownload(downloadId);
    });

    // Save the request to an object so that it can be retrieved and stopped later
    this._activeDownloads[downloadId] = activeDownload;

    return downloadOp;
  }

  /**
   * Stops a download operation
   */
  async stopDownload(downloadId: string): Promise<DownloadOperation> {
    const activeDownload = this._activeDownloads[downloadId];
    if (!activeDownload) {
      throw new NoActiveDownloadError(
        'No active download found for the given ID',
      );
    }

    await activeDownload.stopDownload().finally(() => {
      delete this._activeDownloads[downloadId];
    });

    return activeDownload.downloadOp;
  }

  async finishDownload(downloadId: string): Promise<void> {
    delete this._activeDownloads[downloadId];
  }

  /**
   * Stops the download, deletes the file and removes the download
   * from the queue
   */
  async deleteDownloadOperation(
    downloadId: string,
  ): Promise<DownloadOperation> {
    // Get the active download and download operation
    const activeDownload = this._activeDownloads[downloadId];
    const downloadOp = this._downloadOperations[downloadId];

    // Stop the download. This closes the file handle as well.
    const stoppedDownload = activeDownload?.stopDownload().finally(() => {
      delete this._activeDownloads[downloadId];
    });

    // Delete the file associated with the download operation
    const deletedFile = downloadOp?.deleteFile().finally(() => {
      delete this._downloadOperations[downloadId];
    });

    await Promise.allSettled([stoppedDownload, deletedFile]);

    // If download operation is undefined, throw an error
    if (!downloadOp) {
      throw new NoDownloadOperationError('Invalid download operation ID');
    }

    return downloadOp;
  }
}

// Singleton instance of DownloadManager
export const downloadManager = new DownloadManager();
