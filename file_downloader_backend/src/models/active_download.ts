import * as http from 'node:http';
import * as https from 'node:https';
import { ClientRequest } from 'node:http';
import { EventEmitter } from 'node:stream';
import { FileHandle, open } from 'node:fs/promises';

import { isNumber } from '@metools/tcheck';

import { DownloadOperation } from '@/models/download_operation';
import { DownloadStatus } from '@/models/download_status';
import { updateDownload } from '@/db_controllers/update_download';
import { calculateSpeed, DownloadChunkSpeed } from './speed_tester';

export class ActiveDownload extends EventEmitter {
  /**
   * The HTTP/HTTPS request used for downloading the file. We keep a reference
   * of the request so that we can abort it when the download is stopped.
   */
  private _request?: ClientRequest;

  /**
   * The download operation associated with this active download. This is
   * essentially metadata about the download such as its URL, status,
   * completed bytes, total size, etc. We update this metadata as the
   * download progresses.
   */
  private _downloadOp: DownloadOperation;

  private _currentSpeed: number = 0;

  constructor(_downloadOp: DownloadOperation) {
    super();
    this._downloadOp = _downloadOp;
  }

  get id() {
    return this._downloadOp.id;
  }

  get downloadOp() {
    return this._downloadOp;
  }

  get currentSpeed() {
    return this._currentSpeed;
  }

  /**
   * Convenience function to get the file's size from the download operation.
   * If the file size and the downloaded size are different, we know that
   * something went wrong during the download and subsequent pause.
   */
  async getFileSize() {
    const fileExists = await this.downloadOp.fileExists();
    if (!fileExists) {
      return 0;
    }

    const handle = await open(this.downloadOp.filepath, 'r');
    const stat = await handle.stat().finally(async () => await handle.close());

    return stat.size;
  }

  /**
   * Handles HTTP 3xx redirect responses by extracting the Location header,
   * validating the new URL, updating the download operation's URL, and
   * restarting the download process with the new URL. If the Location header
   * is missing or invalid, it destroys the request with an appropriate error.
   */
  handle300Response(response: http.IncomingMessage, request: ClientRequest) {
    if (!response.headers.location) {
      request.destroy(new Error('Redirect without location header'));
      return;
    }

    try {
      // Creates a new URL object to validate the redirect URL then sets the
      // new URL in the download operation
      this.downloadOp.setNewUrl(new URL(response.headers.location));

      // Destroy after setting the new URL so that we can
      // destroy with an Error if the URL is invalid
      request.destroy();

      // Restart the download with the new URL
      this.startDownload();
      return;
    } catch (_e) {
      request.destroy(
        new Error(`Invalid redirect URL: ${response.headers.location}`),
      );
      return;
    }
  }

  async responseCloseHandler(fileHandle: FileHandle, completedBytes: number) {
    const op = this.downloadOp;
    // Close the file handle
    fileHandle.close();

    op.completedBytes = completedBytes;

    // Determine if the download completed successfully
    if (
      // Completed the download.
      op.status === DownloadStatus.Downloading &&
      op.completedBytes === op.totalSize
    ) {
      op.status = DownloadStatus.Completed;
      await op.renameFile();
    } else {
      // Download was interrupted.
      op.status = DownloadStatus.Paused;
    }

    await updateDownload(op);

    if (op.status === DownloadStatus.Completed) {
      this.emit('finishedDownload', op.id);
    }

    this.emit('downloadClosed');
  }

  /**
   * Sets a data event listener on the HTTP response to handle incoming data chunks.
   * Each chunk is written to a provided fileHandle
   */
  responseDataHandler(response: http.IncomingMessage, fileHandle: FileHandle) {
    const chunkSpeeds: DownloadChunkSpeed[] = [];
    let lastDownloadedChunk = Date.now();

    // Data event to handle the incoming data. Saves the completed bytes per chunk
    response.on('data', (chunk) => {
      const now = Date.now();

      fileHandle.write(chunk);

      chunkSpeeds.push({
        sizeBytes: chunk.length,
        startTimeMs: lastDownloadedChunk,
        endTimeMs: now,
      });

      lastDownloadedChunk = now;

      const speed = calculateSpeed(chunkSpeeds);
      this._currentSpeed = speed;

      // Updated completedBytes only AFTER successfully writing to the stream.
      this.downloadOp.completedBytes += chunk.length;
    });
  }

  /**
   * Receives the HTTP response and handles it accordingly. Checks the status
   * code and processes redirects, errors, and successful responses. Parses
   * headers to determine if the server supports resuming downloads and the
   * total size of the download. Sets up data event listeners to track progress
   * and pipes the response data to the file.
   */
  async responseHandler(
    response: http.IncomingMessage,
    request: ClientRequest,
    fileHandle: FileHandle,
  ) {
    const statusCode = response.statusCode;
    if (!isNumber(statusCode)) {
      request.destroy(new Error('Invalid Response Status Code'));
      return;
    }

    // Handle a 300 redirect
    if (statusCode >= 300 && statusCode < 400) {
      return this.handle300Response(response, request);
    }

    // Handle a non-200 status code
    if (statusCode < 200 || statusCode >= 400) {
      request.destroy(new Error(`Invalid Response Status Code: ${statusCode}`));
      return;
    }

    // Extract the total size from the Content-Length header Sometimes the
    // content-length header will provide the remaining bytes if a Range header
    // is sent. We need to account for that.
    const cl = response.headers['content-length'];
    const totalSize = parseInt(cl ?? '-1', 10);
    if (isNaN(totalSize) || totalSize < 0) {
      const err = new Error(`Invalid Content-Length header: ${cl}`);

      request.destroy(err);
      return;
    }

    if (this.downloadOp.totalSize === -1) {
      // If the total size is not set yet, we set it now
      this.downloadOp.totalSize = totalSize;
    } else if (
      this.downloadOp.totalSize !== totalSize &&
      this.downloadOp.completedBytes + totalSize !== this.downloadOp.totalSize
    ) {
      // If the total size is different from what we have and it's not just
      // the remaining bytes, we have an inconsistency and will restart the download
      request.destroy();
      await this.downloadOp.deleteFile();
      this.startDownload();
    }

    // Extract the accept-ranges header to determine if the server supports resuming
    const acceptsRanges = response.headers['accept-ranges'] === 'bytes';
    this.downloadOp.setSupportsAcceptRanges(acceptsRanges);

    this.responseDataHandler(response, fileHandle);

    response.on('close', async () =>
      this.responseCloseHandler(fileHandle, this.downloadOp.completedBytes),
    );
  }

  /**
   * Start the download process and save ClientRequest
   * Produces a closure that can be used to stop the download
   * Need to save this somewhere so that it can be stopped later
   * We need to handle the following:
   * - Errors during the download
   * - Completion of the download
   * - Pausing the download
   * - Resuming the download
   * - Attempting to resume a download that has already completed
   * - Attempting to resume a download from a server that does not support resuming
   */
  async startDownload() {
    const supportedProtocols = ['http:', 'https:'];

    if (!supportedProtocols.includes(this.downloadOp.url.protocol)) {
      this.downloadOp.status = DownloadStatus.Failed;
      await updateDownload(this.downloadOp);
      throw new Error('Unsupported protocol');
    }

    // Choose between http and https based on the URL protocol
    const get =
      this.downloadOp.url.protocol === 'https:' ? https.get : http.get;

    const fileSize = await this.getFileSize().catch(async (e) => {
      console.error(`Error getting file size: ${e}`);
      this.downloadOp.status = DownloadStatus.Failed;
      await updateDownload(this.downloadOp);
      throw e;
    });
    const canResume = fileSize === this.downloadOp.completedBytes;

    const resumeDownload =
      canResume &&
      this.downloadOp.supportsAcceptRanges &&
      this.downloadOp.completedBytes > 0;

    const headers: Record<string, string> = {};
    if (resumeDownload) {
      headers['Range'] = `bytes=${this.downloadOp.completedBytes}-`;
    }

    // Make the request and save it. The callback will handle the response
    const request = get(this.downloadOp.url, { headers }, async (response) => {
      this._request = request;
      // Should set the status correctly
      this.downloadOp.status = DownloadStatus.Downloading;

      if (!resumeDownload) {
        this.downloadOp.completedBytes = 0;
      }

      const fileHandle = await this.downloadOp.getFileHandle(resumeDownload);

      // Update the download operation in the database
      await updateDownload(this.downloadOp);

      // Now we can handle the response
      this.responseHandler(response, request, fileHandle);
    });

    // Handle errors during the request
    request.on('error', async (error) => {
      console.error('Download failed:', error);

      this.downloadOp.status = DownloadStatus.Failed;

      request.destroy();

      updateDownload(this.downloadOp).catch((e) => {
        console.error(`Error Updating Download: ${e}`);
      });
    });

    return request;
  }

  /**
   * Stops the download operation for the active download, closes the file
   * handle and destroys the request. THis method will rely on the
   * responseCloseHandler to update the download operation's status.
   */
  async stopDownload() {
    const waitObject = new Promise<void>((res) => {
      const opFinishedCallback = () => {
        this.off('downloadClosed', opFinishedCallback);
        res();
      };
      this.on('downloadClosed', opFinishedCallback);
    });

    // Destroy the request to stop the download. Saving the data to
    // the DB is handled in the pipeDataToFile method's finally block
    this._request?.destroy();

    await waitObject;
  }

  /**
   * Creates a new ActiveDownload instance, starts the download process.
   */
  static async newActiveDownload(
    downloadOp: DownloadOperation,
  ): Promise<ActiveDownload> {
    const activeDownload = new ActiveDownload(downloadOp);
    await activeDownload.startDownload();

    return activeDownload;
  }
}
