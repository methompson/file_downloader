import { isString, typeGuardGenerator } from '@metools/tcheck';
import { Request, Response } from 'express';

import { downloadManager } from '@/models/download_manager';
import { NoDownloadOperationError } from '@/models/errors';

interface DeleteDownloadFilePayload {
  downloadId: string;
}

const isDeleteDownloadFilePayload =
  typeGuardGenerator<DeleteDownloadFilePayload>({
    downloadId: isString,
  });

/**
 * This controller will handle deleting a download file.
 * It will do the following:
 * 1. Stop the download if it is active.
 * 2. Remove the download operation from the download manager.
 * 3. Delete the file from the filesystem.
 * 4. Remove the download operation from the database.
 *
 * We delete files from download operations so that we don't litter
 * the filesystem with files that are no longer needed nor
 * accessible. Users should download files before running this
 * operation.
 */
export async function deleteDownloadFileController(
  req: Request,
  res: Response,
) {
  const request = req.body;

  if (!isDeleteDownloadFilePayload(request)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const { downloadId } = request;

  try {
    // Stops all operations and deletes the file
    // Returns the deleted download operation
    const download = await downloadManager.deleteDownloadOperation(downloadId);

    res.json({ download: download.toJSON() });
  } catch (e) {
    if (e instanceof NoDownloadOperationError) {
      res.status(404).json({ error: 'Download operation not found' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
    return;
  }
}
