import path from 'node:path';
import { Request, Response } from 'express';
import { isString } from '@metools/tcheck';

import { downloadManager } from '@/models/download_manager';
import { DownloadStatus } from '@/models/download_status';

export async function getDownloadFileController(req: Request, res: Response) {
  const params = req.params;

  const { id } = params;

  if (!isString(id)) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }

  const op = downloadManager.downloadOperations[id];
  const activeOp = downloadManager.activeDownloads[id];

  if (!op) {
    res.status(404).json({ error: 'Download operation not found' });
    return;
  }

  if (activeOp) {
    res.status(409).json({ error: 'Download is still in progress' });
    return;
  }

  if (op.status !== DownloadStatus.Completed) {
    res.status(409).json({ error: 'Download is not completed' });
    return;
  }

  try {
    res.sendFile(path.resolve(op.filepath), {
      headers: {
        'Content-Disposition': `attachment; filename="${op.filename}"`,
      },
    });
  } catch (e) {
    console.error('Error retrieving file handle:', e);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
}
