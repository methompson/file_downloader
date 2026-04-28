import { Request, Response } from 'express';
import { isRecord, isString, typeGuardGenerator } from '@metools/tcheck';

import { isBooleanOrUndefined, isStringOrUndefined } from '@/utils/type_guards';
import { downloadManager } from '@/models/download_manager';
import { DownloadOperation } from '@/models/download_operation';

interface AddDownloadRequestPayload {
  url: string;
  fileName?: string;
  autoStart?: boolean;
}

const isAddDownloadRequestPayload =
  typeGuardGenerator<AddDownloadRequestPayload>({
    url: isString,
    fileName: isStringOrUndefined,
    autoStart: isBooleanOrUndefined,
  });

export async function addDownloadFileController(req: Request, res: Response) {
  const request = req.body;

  if (!isRecord(request) || !isAddDownloadRequestPayload(request)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  // Create a new DownloadOperation and append it to the download manager
  const op = DownloadOperation.newDownloadOp(request.url, request.fileName);
  downloadManager.addDownloadOperation(op);

  try {
    // Start the download if autoStart is true
    if (request.autoStart) {
      await downloadManager.startDownload(op.id);
    }

    return res.json({
      download: op.toJSON(),
    });
  } catch (e) {
    res.status(500).json({ error: `${e}` });
  }
}
