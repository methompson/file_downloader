import { DownloadOperation } from '@/models/download_operation';
import { getFileDBDir } from '@/utils/config';
import { isRecord, isUndefinedOrNull, not } from '@metools/tcheck';
import { arrayToObject } from '@metools/utils';
import { open } from 'node:fs/promises';
import path from 'node:path';

const fileDBName = 'file_downloader.json';

export async function getDbFileHandle() {
  const location = getFileDBDir();

  const filepath = path.join(location, fileDBName);

  try {
    return await open(filepath, 'r+');
  } catch (e) {
    if (isRecord(e) && e.code === 'ENOENT') {
      // File does not exist, create it
      return await open(filepath, 'w+');
    }
    console.error(`Error opening DB file at ${filepath}: ${e}`);
    throw e;
  }
}

export async function getDBFileContents() {
  const dbFileHandle = await getDbFileHandle();
  const rawData = await dbFileHandle.readFile({ encoding: 'utf-8' });

  try {
    const data = JSON.parse(rawData);

    if (!isRecord(data)) {
      return {};
    }

    const output = Object.values(data)
      .map((entry) => {
        return DownloadOperation.isDownloadOperationJSON(entry)
          ? new DownloadOperation(entry)
          : undefined;
      })
      .filter(not(isUndefinedOrNull));

    return arrayToObject(output, (op) => op.id);
  } catch {
    return {};
  } finally {
    await dbFileHandle.close();
  }
}

export async function writeDBFileContents(
  contents: Record<string, DownloadOperation>,
) {
  const dbFileHandle = await getDbFileHandle();

  const serializableContents: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(contents)) {
    serializableContents[key] = value.toJSON();
  }

  await dbFileHandle.truncate(0);
  await dbFileHandle.writeFile(JSON.stringify(serializableContents, null, 2), {
    encoding: 'utf-8',
  });

  await dbFileHandle.close();
}
