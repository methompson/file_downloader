import {
  access,
  constants,
  FileHandle,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  isString,
  typeGuardGenerator,
  typeGuardTestGenerator,
} from '@metools/tcheck';

import { getDownloadDir, getDownloadTempDir } from '@/utils/config';
import { DownloadStatus, isDownloadStatus } from '@/models/download_status';
import {
  isBooleanOrUndefined,
  isNumberOrUndefined,
  isStringOrUndefined,
} from '@/utils/type_guards';

/**
 * This JSON interface represents the serializable form of a DownloadOperation.
 * It includes both the "new" data that is provided by the client as well data
 * that is managed internally by the application (like completedBytes and
 * supportsAcceptRanges). This interface is used for persisting DownloadOperation
 * instances to disk or transmitting them over a network.
 */
interface DownloadOperationJSON {
  id: string;
  url: string;
  status: DownloadStatus;
  originalUrl?: string;
  filename?: string;
  totalSize?: number;
  completedBytes?: number;
  supportsAcceptRanges?: boolean;
}

const downloadOperationJSONCommon = {
  id: isString,
  originalUrl: isString,
  url: isString,
  status: isDownloadStatus,
  filename: isStringOrUndefined,
  totalSize: isNumberOrUndefined,
  completedBytes: isNumberOrUndefined,
  supportsAcceptRanges: isBooleanOrUndefined,
};

const isDownloadOperationJSON = typeGuardGenerator<DownloadOperationJSON>(
  downloadOperationJSONCommon,
);
const downloadOperationJSONTest = typeGuardTestGenerator(
  downloadOperationJSONCommon,
);

/**
 * DownloadOperation represents all of the state of a download operation.
 * The class is designed to mutate over time as the download progresses.
 * E.g. as more bytes are downloaded, the completedBytes property is
 * updated.
 * The state can be serialized to JSON for persistence.
 */
export class DownloadOperation {
  private _id: string;
  private _originalUrl: string;
  private _url: URL;
  private _totalSize: number = -1;
  private _completedBytes: number = 0;
  private _filename?: string;
  private _supportsAcceptRanges: boolean = false;

  status: DownloadStatus;

  constructor(payload: DownloadOperationJSON) {
    this._id = payload.id;
    this._url = new URL(payload.url);
    this._originalUrl = payload.originalUrl ?? payload.url;
    this.status = payload.status;
    this._totalSize = payload.totalSize ?? -1;
    this._completedBytes = payload.completedBytes ?? 0;
    this._filename = payload.filename ?? '';
    this._supportsAcceptRanges = payload.supportsAcceptRanges ?? false;
  }

  // The ID used to identify the download operation, especially when
  // multiple downloads have the same file name.
  get id() {
    return this._id;
  }

  // The URL of the file being downloaded
  get url() {
    return this._url;
  }

  // The total number of bytes for the file. If it's set to
  // -1, it means that the total size is unknown.
  get totalSize() {
    return this._totalSize;
  }
  // Do we need to do anything further?
  set totalSize(size: number) {
    this._totalSize = size;
  }

  // The number of bytes that have been downloaded so far
  get completedBytes() {
    return this._completedBytes;
  }
  // Do we need to do anything further?
  set completedBytes(bytes: number) {
    this._completedBytes = bytes;
  }

  // The name of the file being downloaded.
  get filename() {
    return this._filename ? this._filename : this.getFileNameFromUrl();
  }

  get supportsAcceptRanges() {
    return this._supportsAcceptRanges;
  }

  get tempFilePath(): string {
    const savedFileDirectoryPath = getDownloadTempDir();
    const filepath = path.join(savedFileDirectoryPath, this._id);
    return filepath;
  }
  get completedFilePath(): string {
    const savedFileDirectoryPath = getDownloadDir();
    const filepath = path.join(savedFileDirectoryPath, this.filename);
    return filepath;
  }

  get filepath(): string {
    return this.status === DownloadStatus.Completed
      ? this.completedFilePath
      : this.tempFilePath;
  }

  async fileExists() {
    try {
      await access(this.filepath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getFileHandle(resumeDownload?: boolean): Promise<FileHandle> {
    const filepath = this.filepath;

    // If there's no bytes completed, we'll create the file using 'w' mode
    // If there are bytes, but does not support accept ranges, we'll use 'w' mode
    // to truncate the file
    // If there are bytes and it supports accept ranges, we'll use 'a' mode

    const downloadedBytes = this._completedBytes > 0;
    const acceptsRanges = this._supportsAcceptRanges;

    const shouldResume = resumeDownload ?? (downloadedBytes && acceptsRanges);

    const openMode = shouldResume ? 'a' : 'w';
    return open(filepath, openMode);
  }

  async renameFile() {
    const tempPath = getDownloadTempDir();
    const finalPath = getDownloadDir();

    const tempFilePath = path.join(tempPath, this._id);
    const finalFilePath = path.join(finalPath, this.filename);

    return rename(tempFilePath, finalFilePath);
  }

  async deleteFile() {
    const filepath = this.filepath;

    return rm(filepath);
  }

  setNewUrl(url: URL) {
    this._url = url;
  }

  setSupportsAcceptRanges(supports: boolean) {
    this._supportsAcceptRanges = supports;
  }

  getFileNameFromUrl() {
    const urlParts = this._url.pathname.split('/');
    const lastPart = urlParts[urlParts.length - 1];

    if (!isString(lastPart) || lastPart.length === 0) {
      return this._id;
    }

    return lastPart;
  }

  toJSON(): DownloadOperationJSON {
    return {
      id: this._id,
      url: this._url.toString(),
      originalUrl: this._originalUrl,
      status: this.status,
      totalSize: this._totalSize,
      completedBytes: this._completedBytes,
      supportsAcceptRanges: this._supportsAcceptRanges,
    };
  }

  static fromJSON(json: unknown): DownloadOperation {
    if (!DownloadOperation.isDownloadOperationJSON(json)) {
      const test = downloadOperationJSONTest(json);
      throw new Error(`Invalid DownloadOperation JSON: ${test.join(', ')}`);
    }

    return new DownloadOperation({
      id: json.id,
      url: json.url,
      originalUrl: json.originalUrl,
      status: json.status,
      totalSize: json.totalSize,
      completedBytes: json.completedBytes,
      supportsAcceptRanges: json.supportsAcceptRanges,
    });
  }

  static isDownloadOperationJSON = isDownloadOperationJSON;

  static newDownloadOp(urlStr: string, filename?: string) {
    return new DownloadOperation({
      id: crypto.randomUUID(),
      url: urlStr,
      originalUrl: urlStr,
      status: DownloadStatus.Pending,
      filename,
    });
  }
}
