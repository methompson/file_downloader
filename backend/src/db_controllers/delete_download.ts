import {
  getDBFileContents,
  writeDBFileContents,
} from '@/db_controllers/get_db_file_handle';

/**
 * Deletes a download entry from the database.
 */
export async function deleteDownload(downloadId: string) {
  return deleteDownloadFromFile(downloadId);
}

async function deleteDownloadFromFile(downloadId: string) {
  const dbContents = await getDBFileContents();

  if (!dbContents[downloadId]) {
    throw new Error(`Download with ID ${downloadId} does not exist.`);
  }

  delete dbContents[downloadId];

  await writeDBFileContents(dbContents);
}
