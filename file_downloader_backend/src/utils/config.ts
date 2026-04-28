import { mkdir } from 'fs/promises';

export function getDownloadDir() {
  return process.env.DOWNLOAD_DIR ?? './files/downloads';
}

export function getDownloadTempDir() {
  return process.env.DOWNLOAD_TEMP_DIR ?? './files/downloads/temp';
}

export function getFileDBDir() {
  return process.env.FILE_DB_DIR ?? './files/db';
}

export async function initilaizeFileDirectories() {
  return await Promise.all([
    mkdir(getDownloadDir(), { recursive: true }),
    mkdir(getDownloadTempDir(), { recursive: true }),
    mkdir(getFileDBDir(), { recursive: true }),
  ]);
}
