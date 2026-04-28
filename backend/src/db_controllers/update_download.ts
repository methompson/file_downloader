import { DownloadOperation } from '@/models/download_operation';
import {
  getDBFileContents,
  writeDBFileContents,
} from '@/db_controllers/get_db_file_handle';

/**
 * Updates an existing download entry in the database.
 */
export async function updateDownload(download: DownloadOperation) {
  return updateDownloadToFile(download);
}

async function updateDownloadToFile(download: DownloadOperation) {
  const dbContents = await getDBFileContents();

  dbContents[download.id] = download;

  await writeDBFileContents(dbContents);
}
