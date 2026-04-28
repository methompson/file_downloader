export class DownloaderError extends Error {
  constructor(message: string) {
    super(message);
    this.message = 'DownloaderError';
  }
}

export class NoActiveDownloadError extends DownloaderError {}
export class NoDownloadOperationError extends DownloaderError {}
