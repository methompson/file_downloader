import { isRecord } from '@metools/tcheck';

import { getDBFileContents } from '@/db_controllers/get_db_file_handle';
import { downloadManager } from '@/models/download_manager';

export async function initData() {
  const data = await getDBFileContents();

  if (!isRecord(data)) {
    return;
  }

  Object.values(data).forEach((entry) => {
    downloadManager.addDownloadOperation(entry);
  });

  console.log('Data initialization complete');
}
