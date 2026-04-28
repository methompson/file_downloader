import { Request, Response } from 'express';
import { isString, typeGuardGenerator } from '@metools/tcheck';

import { downloadManager } from '@/models/download_manager';
import { NoActiveDownloadError } from '@/models/errors';

interface StopDownloadPayload {
  downloadId: string;
}

const isStopDownloadPayload = typeGuardGenerator<StopDownloadPayload>({
  downloadId: isString,
});

/**
 * Stops a download operation. This only halts the download operation
 * and saves the current state, bytes downloaded, etc.
 */
export async function stopDownloadFileController(req: Request, res: Response) {
  const request = req.body;

  if (!isStopDownloadPayload(request)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  try {
    const download = await downloadManager.stopDownload(request.downloadId);

    res.json({
      download: download.toJSON(),
    });
  } catch (e) {
    if (e instanceof NoActiveDownloadError) {
      res.status(404).json({ error: e.message });
      return;
    }

    res.status(500).json({ error: `${e}` });
  }
}
