import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { arrayToObject, split } from '@metools/utils';

import { downloadManager } from '@/models/download_manager';
import { DownloadStatus } from '@/models/download_status';
import { getDownloadDir, getDownloadTempDir } from '@/utils/config';
import { updateDownload } from '@/db_controllers/update_download';

/**
 * Finds all files in the file directories and finds any files that exist
 * on disk, but are not referenced by any download operations.
 */
export async function cleanFiles() {
  // Get all download operations
  const ops = downloadManager.downloadOperations;

  // Separate into finished and pending downloads
  const [finishedOps, pendingOps] = split(
    Object.values(ops),
    (op) => op.status === DownloadStatus.Completed,
  );

  // Create lookup objects for easy checking
  const finishedFileNames = arrayToObject(
    finishedOps.map((op) => op.filename),
    (name) => name,
  );
  const pendingFileNames = arrayToObject(
    pendingOps.map((op) => op.id),
    (name) => name,
  );

  // Read all files in the download directories
  const [finishedFiles, pendingFiles] = await Promise.all([
    readdir(getDownloadDir(), { withFileTypes: true }).then((finishedRaw) =>
      finishedRaw.filter((f) => f.isFile()).map((f) => f.name),
    ),
    readdir(getDownloadTempDir(), { withFileTypes: true }).then((pendingRaw) =>
      pendingRaw.filter((f) => f.isFile()).map((f) => f.name),
    ),
  ]);

  // Find orphaned files that are not referenced by any download operation
  const finishedOrphans = finishedFiles.filter(
    (filename) => !finishedFileNames[filename],
  );
  const pendingOrphans = pendingFiles.filter(
    (filename) => !pendingFileNames[filename],
  );

  // Delete all orphaned files
  const delOps = [
    ...finishedOrphans.map((filename) =>
      rm(path.join(getDownloadDir(), filename)),
    ),
    ...pendingOrphans.map((filename) =>
      rm(path.join(getDownloadTempDir(), filename)),
    ),
  ];

  // Execute deletions
  await Promise.all(delOps);

  // Iterate through all remaining files and see if the files on
  // disk match the expected size of the download operation. If not, delete the file.
  // and reset the compltedBytes to 0.

  await Promise.all(
    pendingOps.map(async (op) => {
      if (op.completedBytes === 0) {
        // No File
        return;
      }

      const file = await op.getFileHandle();
      const stats = await file.stat();

      if (stats.size !== op.completedBytes) {
        await file.close();
        await rm(path.join(op.filepath));
        op.completedBytes = 0;
        updateDownload(op);
      } else {
        await file.close();
      }
    }),
  );
}
