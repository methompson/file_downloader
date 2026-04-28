import { Request, Response } from 'express';

import { downloadManager } from '@/models/download_manager';

export async function getDownloadsController(req: Request, res: Response) {
  const ops = downloadManager.downloadOperations;

  const downloadOperations = Object.values(ops);

  const activeDownloads = Object.values(downloadManager.activeDownloads).map(
    (ad) => ({
      id: ad.downloadOp.id,
      currentSpeed: ad.currentSpeed,
    }),
  );

  res.json({
    downloadOperations,
    activeDownloads,
  });
}
