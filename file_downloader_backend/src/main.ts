import express, { Router } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import 'dotenv/config';

import { authCheckMiddleware, initializeAppAuth } from '@/auth/initialize_auth';
import { initilaizeFileDirectories } from '@/utils/config';
import { initData } from '@/db_controllers/init_data';
import { cleanFiles } from '@/utils/clean_files';

import { addDownloadFileController } from '@/route_controller/post_add_download_file_controller';
import { stopDownloadFileController } from '@/route_controller/post_stop_download_file_controller';
import { deleteDownloadFileController } from '@/route_controller/post_delete_download_file_controller';
import { getDownloadFileController } from '@/route_controller/get_download_file_controller';
import { getDownloadsController } from '@/route_controller/get_downloads_controller';
import { resumeDownloadFileController } from '@/route_controller/post_resume_download_file_controller';

async function startUp() {
  initializeAppAuth();
  await initilaizeFileDirectories();
  await initData();
  await cleanFiles();

  const app = express();
  app.use(express.json());
  app.use(cors());
  app.use(cookieParser());

  const appRouter = Router();
  appRouter.use(authCheckMiddleware);

  // Queue a download file
  appRouter.post('/addDownload', addDownloadFileController);
  // Stop, pause, resume, delete, and get downloads
  appRouter.post('/stopDownload', stopDownloadFileController);
  appRouter.post('/resumeDownload', resumeDownloadFileController);
  appRouter.post('/deleteDownload', deleteDownloadFileController);

  // Get a list of all download files
  appRouter.get('/getDownloads', getDownloadsController);
  appRouter.get('/getDownloadFile/:id', getDownloadFileController);

  app.use('/api', appRouter);

  const port = Number.isNaN(parseInt(process.env.PORT ?? '', 10))
    ? 3000
    : parseInt(process.env.PORT ?? '', 10);

  app.listen(port, () => {
    console.log(`2025-02-09, Server is running on port ${port}`);
  });
}
startUp();
