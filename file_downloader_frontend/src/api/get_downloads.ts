import { isArrayOfGenerator, isRecord } from '@metools/tcheck';

import { getURL } from '@/api/get_url';

import {
  isActiveDownloadInfo,
  type ActiveDownloadInfo,
} from '@/models/active_download_info';
import {
  isDownloadOperation,
  type DownloadOperation,
} from '@/models/download_operation';

interface GetDownloadsResponse {
  downloadOperations: DownloadOperation[];
  activeDownloads: ActiveDownloadInfo[];
}

const isDownloadOperationArray = isArrayOfGenerator(isDownloadOperation);
const isActiveDownloadInfoArray = isArrayOfGenerator(isActiveDownloadInfo);

export async function getDownloads(): Promise<GetDownloadsResponse> {
  const baseURL = getURL();

  const url = `${baseURL}/getDownloads`;

  const result = await fetch(url);

  if (!result.ok) {
    throw new Error(`Error fetching downloads: ${result.statusText}`);
  }

  const data = await result.json();

  // Check if the data is valid

  if (!isRecord(data)) {
    throw new Error('Invalid data format received from server');
  }

  const { downloadOperations, activeDownloads } = data;

  if (
    !isDownloadOperationArray(downloadOperations) ||
    !isActiveDownloadInfoArray(activeDownloads)
  ) {
    throw new Error('Invalid Response');
  }

  return {
    downloadOperations,
    activeDownloads,
  };
}
