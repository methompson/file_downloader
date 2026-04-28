import { Request, Response } from 'express';
import { isString, typeGuardGenerator } from '@metools/tcheck';
import { downloadManager } from '@/models/download_manager';
import { NoDownloadOperationError } from '@/models/errors';

interface ResumeDownloadPayload {
  downloadId: string;
}

const isResumeDownloadPayload = typeGuardGenerator<ResumeDownloadPayload>({
  downloadId: isString,
});

/**
 * Starts a download.
 */
export async function resumeDownloadFileController(
  req: Request,
  res: Response,
) {
  const request = req.body;

  if (!isResumeDownloadPayload(request)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  try {
    const op = await downloadManager.startDownload(request.downloadId);

    res.json({ download: op.toJSON() });
  } catch (e) {
    if (e instanceof NoDownloadOperationError) {
      res.status(404).json({ error: 'Download operation not found' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}
