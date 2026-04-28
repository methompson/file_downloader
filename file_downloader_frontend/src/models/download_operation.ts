import { typeGuardGenerator } from '@metools/tcheck';

import type { DownloadStatus } from './download_status';

export interface DownloadOperation {
  id: string;
  url: string;
  originalUrl: string;
  status: DownloadStatus;
  totalSize: number;
  completedBytes: number;
  supportsAcceptRanges: boolean;
}

export const isDownloadOperation = typeGuardGenerator<DownloadOperation>({});
