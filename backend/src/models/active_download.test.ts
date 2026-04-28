import * as http from 'node:http';

import * as fsPromisesModule from 'node:fs/promises';
import nock from 'nock';

import * as UpdateDownloadModule from '@/db_controllers/update_download';

import { DownloadOperation } from './download_operation';
import { DownloadStatus } from './download_status';
import { ActiveDownload } from './active_download';
import { EventEmitter } from 'node:stream';

vi.mock('node:fs/promises');
vi.mock('@/db_controllers/update_download');

const { open } = vi.mocked(fsPromisesModule);
const { updateDownload } = vi.mocked(UpdateDownloadModule);

const httpDownloadOpJSON = {
  id: 'download-1',
  url: 'http://www.example.com/file.zip',
  status: DownloadStatus.Pending,
};
let httpDownloadOp = new DownloadOperation(httpDownloadOpJSON);

class ResponseMock extends EventEmitter {
  constructor(
    public statusCode: number,
    public headers: Record<string, string>,
  ) {
    super();
  }

  manualEmit(name: string, value?: unknown) {
    this.emit(name, value);
  }
}

const errorSpy = vi.spyOn(console, 'error');
const logSpy = vi.spyOn(console, 'log');

describe('ActiveDownload', () => {
  beforeEach(() => {
    httpDownloadOp = new DownloadOperation(httpDownloadOpJSON);

    vi.resetAllMocks();
    nock.cleanAll();

    errorSpy.mockImplementation(() => {});
    logSpy.mockImplementation(() => {});
    updateDownload.mockResolvedValue();
  });

  describe('handle300Response', () => {
    test('handles a 300 redirect status code and restarts the download with the new URL', async () => {
      const newURL = 'http://www.example.com/newfile.zip';
      const response = {
        headers: {
          location: newURL,
        },
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const activeDownload = new ActiveDownload(httpDownloadOp);
      const startDownloadSpy = vi.spyOn(activeDownload, 'startDownload');
      startDownloadSpy.mockResolvedValueOnce({} as http.ClientRequest);

      activeDownload.handle300Response(response, request);

      expect(activeDownload.downloadOp.url.href).toBe(newURL);
      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith();
      expect(startDownloadSpy).toHaveBeenCalledTimes(1);
    });

    test('handles a 300 redirect status code without a redirect location', async () => {
      const response = {
        headers: {},
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const activeDownload = new ActiveDownload(httpDownloadOp);
      const originalURL = activeDownload.downloadOp.url.href;

      const startDownloadSpy = vi.spyOn(activeDownload, 'startDownload');
      startDownloadSpy.mockResolvedValueOnce({} as http.ClientRequest);

      activeDownload.handle300Response(response, request);

      expect(activeDownload.downloadOp.url.href).toBe(originalURL);

      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith(
        new Error('Redirect without location header'),
      );
      expect(startDownloadSpy).not.toHaveBeenCalled();
    });

    test('handles an error if the url is invalid', async () => {
      const newURL = 'some mangled URL';
      const response = {
        headers: {
          location: newURL,
        },
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const activeDownload = new ActiveDownload(httpDownloadOp);
      const originalURL = activeDownload.downloadOp.url.href;

      const startDownloadSpy = vi.spyOn(activeDownload, 'startDownload');
      startDownloadSpy.mockResolvedValueOnce({} as http.ClientRequest);

      activeDownload.handle300Response(response, request);

      expect(activeDownload.downloadOp.url.href).toBe(originalURL);

      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith(
        new Error(`Invalid redirect URL: ${newURL}`),
      );
      expect(startDownloadSpy).not.toHaveBeenCalled();
    });
  });

  describe('responseCloseHandler', () => {
    test('closes the file handle, updates the download and emits the "downloadClosed" event and sets the status to Paused', async () => {
      const close = vi.fn(async () => {});
      const fileHandle = { close } as unknown as fsPromisesModule.FileHandle;
      const completedBytes = 512;

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOpJSON,
          totalSize: 1024,
          status: DownloadStatus.Downloading,
        }),
      );
      const emitSpy = vi.spyOn(activeDownload, 'emit');

      expect(activeDownload.downloadOp.completedBytes).toBe(0);

      await activeDownload.responseCloseHandler(fileHandle, completedBytes);

      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.completedBytes).toBe(completedBytes);
      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Paused);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith('downloadClosed');
    });

    test('Sets DownloadStatus.Completed and calls renameFile if the Download is Downloading and completedBytes and totalSize match. Also emits finishedDownload', async () => {
      const close = vi.fn(async () => {});
      const fileHandle = { close } as unknown as fsPromisesModule.FileHandle;
      const completedBytes = 512;

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOpJSON,
          totalSize: completedBytes,
          status: DownloadStatus.Downloading,
        }),
      );
      const emitSpy = vi.spyOn(activeDownload, 'emit');

      expect(activeDownload.downloadOp.completedBytes).toBe(0);

      await activeDownload.responseCloseHandler(fileHandle, completedBytes);

      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.completedBytes).toBe(completedBytes);
      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Completed);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(
        1,
        'finishedDownload',
        activeDownload.downloadOp.id,
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2, 'downloadClosed');
    });
  });

  describe('responseHandler', () => {
    test('Gets statusCode, acceptsRanges, totalSize, completed bytes and sets up data event listeners on the response', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      const response = {
        statusCode: 200,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': '1024',
        },
        on: vi.fn(),
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(response, request, fileHandle);

      expect(request.destroy).not.toHaveBeenCalled();

      expect(response.on).toHaveBeenCalledTimes(2);
      expect(response.on).toHaveBeenNthCalledWith(
        1,
        'data',
        expect.any(Function),
      );
      expect(response.on).toHaveBeenNthCalledWith(
        2,
        'close',
        expect.any(Function),
      );

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(true);
      expect(activeDownload.downloadOp.totalSize).toBe(1024);

      expect(write).not.toHaveBeenCalled();
    });

    test('exits early, destroys the request with an error if the status code is not a number', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      const response = {
        statusCode: 'something',
        headers: {
          'accept-ranges': 'bytes',
          'content-length': '1024',
        },
        on: vi.fn(),
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(response, request, fileHandle);

      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith(
        new Error('Invalid Response Status Code'),
      );

      expect(response.on).not.toHaveBeenCalled();

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      expect(write).not.toHaveBeenCalled();
    });

    test('exits early and handles a 300 response by calling handle300Response', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);
      const handle300Spy = vi.spyOn(activeDownload, 'handle300Response');
      handle300Spy.mockReturnValueOnce();

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      const response = {
        statusCode: 300,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': '1024',
        },
        on: vi.fn(),
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(response, request, fileHandle);

      expect(request.destroy).not.toHaveBeenCalled();
      expect(handle300Spy).toHaveBeenCalledTimes(1);

      expect(response.on).not.toHaveBeenCalled();

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      expect(write).not.toHaveBeenCalled();
    });

    test('exits early and destroys the request with an error if the status code is a non-200 and non-300 status code number', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      const statusCode = 400;
      const response = {
        statusCode,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': '1024',
        },
        on: vi.fn(),
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(response, request, fileHandle);

      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith(
        new Error(`Invalid Response Status Code: ${statusCode}`),
      );

      expect(response.on).not.toHaveBeenCalled();

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      expect(write).not.toHaveBeenCalled();
    });

    test('destroys the pipe if the Content-Length header is invalid', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      const contentLength = 'invalid-size';
      const response = {
        statusCode: 200,
        headers: {
          'accept-ranges': 'bytes',
          'content-length': contentLength,
        },
        on: vi.fn(),
      } as unknown as http.IncomingMessage;

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(response, request, fileHandle);

      expect(request.destroy).toHaveBeenCalledTimes(1);
      expect(request.destroy).toHaveBeenCalledWith(
        new Error(`Invalid Content-Length header: ${contentLength}`),
      );

      expect(response.on).not.toHaveBeenCalled();

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);

      expect(write).not.toHaveBeenCalled();
    });

    test('Saves total size of the download from the chunk array size from the data events', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseCloseSpy = vi.spyOn(activeDownload, 'responseCloseHandler');

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);
      expect(activeDownload.downloadOp.completedBytes).toBe(0);

      const response = new ResponseMock(200, {
        'accept-ranges': 'bytes',
        'content-length': '1024',
      });
      const responseOn = vi.spyOn(response, 'on');

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(
        response as unknown as http.IncomingMessage,
        request,
        fileHandle,
      );

      expect(request.destroy).not.toHaveBeenCalled();

      expect(responseOn).toHaveBeenCalledTimes(2);
      expect(responseOn).toHaveBeenNthCalledWith(
        1,
        'data',
        expect.any(Function),
      );
      expect(responseOn).toHaveBeenNthCalledWith(
        2,
        'close',
        expect.any(Function),
      );

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(true);
      expect(activeDownload.downloadOp.totalSize).toBe(1024);

      await new Promise<void>((res) => {
        response.on('close', res);

        response.manualEmit('close');
      });

      expect(responseCloseSpy).toHaveBeenCalledTimes(1);
    });

    test('Calls the responseCloseHandler on response close', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);
      expect(activeDownload.downloadOp.completedBytes).toBe(0);

      const response = new ResponseMock(200, {
        'accept-ranges': 'bytes',
        'content-length': '1024',
      });
      const responseOn = vi.spyOn(response, 'on');

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(
        response as unknown as http.IncomingMessage,
        request,
        fileHandle,
      );

      expect(responseOn).toHaveBeenCalledTimes(2);
      expect(responseOn).toHaveBeenNthCalledWith(
        1,
        'data',
        expect.any(Function),
      );
      expect(responseOn).toHaveBeenNthCalledWith(
        2,
        'close',
        expect.any(Function),
      );

      expect(request.destroy).not.toHaveBeenCalled();
    });

    test('appends the total size of multiple data events to completed bytes', async () => {
      const startOfSize = 200;
      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          completedBytes: startOfSize,
        }),
      );

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(false);
      expect(activeDownload.downloadOp.totalSize).toBe(-1);
      expect(activeDownload.downloadOp.completedBytes).toBe(startOfSize);

      const response = new ResponseMock(200, {
        'accept-ranges': 'bytes',
        'content-length': '1024',
      });
      const responseOn = vi.spyOn(response, 'on');

      const request = {
        destroy: vi.fn(),
      } as unknown as http.ClientRequest;

      const write = vi.fn();
      const fileHandle = {
        write,
      } as unknown as fsPromisesModule.FileHandle;

      activeDownload.responseHandler(
        response as unknown as http.IncomingMessage,
        request,
        fileHandle,
      );

      expect(request.destroy).not.toHaveBeenCalled();

      expect(responseOn).toHaveBeenCalledTimes(2);
      expect(responseOn).toHaveBeenNthCalledWith(
        1,
        'data',
        expect.any(Function),
      );
      expect(responseOn).toHaveBeenNthCalledWith(
        2,
        'close',
        expect.any(Function),
      );

      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(true);
      expect(activeDownload.downloadOp.totalSize).toBe(1024);

      const bufToSend1 = Buffer.from('Test file content');
      const bufToSend2 = Buffer.from('More content');

      await new Promise<void>((res) => {
        response.on('end', res);

        response.manualEmit('data', bufToSend1);
        expect(activeDownload.downloadOp.completedBytes).toBe(
          startOfSize + bufToSend1.length,
        );

        response.manualEmit('data', bufToSend2);
        expect(activeDownload.downloadOp.completedBytes).toBe(
          startOfSize + bufToSend1.length + bufToSend2.length,
        );
        response.manualEmit('end');
      });

      expect(activeDownload.downloadOp.completedBytes).toBe(
        startOfSize + bufToSend1.length + bufToSend2.length,
      );
    });
  });

  describe('startDownload', () => {
    test('gets & sets a file handle, sets the downloadStatus and makes a download Request', async () => {
      expect.assertions(9);

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(
          200,
          function () {
            expect(this.req.headers.range).toBeUndefined();
            return responseBuf;
          },
          {
            'content-length': `${responseBuf.length}`,
          },
        );

      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: 2048 }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Downloading);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(responseHandlerSpy).toHaveBeenCalled();

      expect(nock.isDone()).toBe(true);
    });

    test('throws an error if the protocol is unsupported', async () => {
      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          url: 'ftp://www.example.com/file.zip',
        }),
      );
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: 2048 }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      await expect(activeDownload.startDownload()).rejects.toThrow(
        new Error('Unsupported protocol'),
      );

      expect(stat).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);
      expect(responseHandlerSpy).not.toHaveBeenCalled();

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Failed);
    });

    test('adds a range header if supportAcceptRanges is true, some data has been downloaded and the file size and stored size match', async () => {
      expect.assertions(9);

      const completedBytes = 2048;

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(
          200,
          function () {
            expect(this.req.headers.range).toBe(`bytes=${completedBytes}-`);
            return responseBuf;
          },
          {
            'content-length': `${responseBuf.length}`,
          },
        );

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          supportsAcceptRanges: true,
          completedBytes,
        }),
      );
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: completedBytes }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Downloading);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(responseHandlerSpy).toHaveBeenCalled();

      expect(nock.isDone()).toBe(true);
    });

    test('Does not add a range header if some amount of data has already downloaded but supportAcceptRanges is false', async () => {
      expect.assertions(9);

      const completedBytes = 5;

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(
          200,
          function () {
            expect(this.req.headers.range).toBeUndefined();
            return responseBuf;
          },
          {
            'content-length': `${responseBuf.length}`,
          },
        );

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          completedBytes,
        }),
      );
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: 2048 }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Downloading);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(responseHandlerSpy).toHaveBeenCalled();

      expect(nock.isDone()).toBe(true);
    });

    test('Does not add a range header supportAcceptRanges is true but no data has been downloaded', async () => {
      expect.assertions(9);

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(
          200,
          function () {
            expect(this.req.headers.range).toBeUndefined();
            return responseBuf;
          },
          {
            'content-length': `${responseBuf.length}`,
          },
        );

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          supportsAcceptRanges: true,
        }),
      );
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: 2048 }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Downloading);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(responseHandlerSpy).toHaveBeenCalled();

      expect(nock.isDone()).toBe(true);
    });

    test('Does not add a range header supportAcceptRanges is true and data has been downloaded, but file size and stored size do not match', async () => {
      expect.assertions(9);

      const completedBytes = 2048;

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(
          200,
          function () {
            expect(this.req.headers.range).toBe(undefined);
            return responseBuf;
          },
          {
            'content-length': `${responseBuf.length}`,
          },
        );

      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          supportsAcceptRanges: true,
          completedBytes,
        }),
      );
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      responseHandlerSpy.mockResolvedValue();

      const stat = vi.fn(async () => ({ size: completedBytes - 1 }));
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Downloading);

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(responseHandlerSpy).toHaveBeenCalled();

      expect(nock.isDone()).toBe(true);
    });

    test('sets download status to Failed  and updates the status on immediate failure, ', async () => {
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .replyWithError('something awful happened');

      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');

      const size = 512;
      const stat = vi.fn();
      stat.mockResolvedValue({ size });

      const close = vi.fn();
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      const request = await activeDownload.startDownload();

      const destroySpy = vi.spyOn(request, 'destroy');

      await new Promise<void>((res) => request.on('close', res));

      // Getting File Size
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(responseHandlerSpy).not.toHaveBeenCalled();

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Failed);

      expect(destroySpy).toHaveBeenCalledTimes(1);

      expect(nock.isDone()).toBe(true);
    });

    test('throws an error if getting the file handle fails', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');

      const err = new Error('Failed to open file');
      open.mockRejectedValueOnce(err);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      await expect(activeDownload.startDownload()).rejects.toThrow(err);

      expect(open).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Failed);

      expect(responseHandlerSpy).not.toHaveBeenCalled();

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);
    });

    test('throws an error if stat fails', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');

      const err = new Error('Failed to open file');
      const stat = vi.fn().mockRejectedValueOnce(err);
      const close = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
      };
      open.mockResolvedValue(openResp as any);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      await expect(activeDownload.startDownload()).rejects.toThrow(err);

      expect(open).toHaveBeenCalledTimes(1);
      expect(stat).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Failed);

      expect(responseHandlerSpy).not.toHaveBeenCalled();

      expect(updateDownload).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledWith(activeDownload.downloadOp);
    });
  });

  describe('stopDownload', () => {
    test('calls abort on the abortcontroller and updates downloadOp', async () => {
      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          status: DownloadStatus.Downloading,
          completedBytes: 2,
        }),
      );

      const destroy = vi.fn();
      const request = {
        destroy,
      } as unknown as http.ClientRequest;
      activeDownload['_request'] = request;

      setTimeout(() => activeDownload['emit']('downloadClosed'), 0);

      await activeDownload.stopDownload();

      expect(destroy).toHaveBeenCalledTimes(1);
    });

    test('only destroys the request if the download is set to Completed', async () => {
      const activeDownload = new ActiveDownload(
        new DownloadOperation({
          ...httpDownloadOp.toJSON(),
          status: DownloadStatus.Completed,
          completedBytes: 1234,
        }),
      );

      const destroy = vi.fn();
      const request = {
        destroy,
      } as unknown as http.ClientRequest;
      activeDownload['_request'] = request;

      setTimeout(() => activeDownload['emit']('downloadClosed'), 0);
      await activeDownload.stopDownload();

      expect(destroy).toHaveBeenCalledTimes(1);

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Completed);
    });
  });

  describe('integration', () => {
    test('full download flow from startDownload to finishDownload', async () => {
      const activeDownload = new ActiveDownload(httpDownloadOp);
      const responseHandlerSpy = vi.spyOn(activeDownload, 'responseHandler');
      const emitSpy = vi.spyOn(activeDownload, 'emit');

      const renameFileSpy = vi.spyOn(activeDownload.downloadOp, 'renameFile');
      const fileExistsSpy = vi.spyOn(activeDownload.downloadOp, 'fileExists');
      fileExistsSpy.mockResolvedValueOnce(false);

      updateDownload.mockResolvedValue();

      // Setting up mocks for startDownload
      const stat = vi.fn(async () => ({ size: 2048 }));
      const close = vi.fn(async () => {});
      const write = vi.fn(async () => {});
      const openResp = {
        stat,
        close,
        write,
      } as unknown as fsPromisesModule.FileHandle;
      open.mockResolvedValue(openResp);

      const responseBuf = Buffer.from('Test file content');
      nock(httpDownloadOp.url.origin)
        .get(httpDownloadOp.url.pathname)
        .reply(200, responseBuf, {
          'content-length': `${responseBuf.length}`,
          'accept-ranges': 'bytes',
        });

      // Setting up mocks for responseHandler

      expect(emitSpy).not.toHaveBeenCalled();

      await activeDownload.startDownload();

      // Initial StartDownload function calls

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Pending);

      expect(fileExistsSpy).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();

      await new Promise<void>((res) =>
        activeDownload.on('downloadClosed', res),
      );

      // startDownload get callback function calls

      expect(open).toHaveBeenCalledTimes(1);
      expect(updateDownload).toHaveBeenCalledTimes(2);

      // responseHandler function calls
      expect(activeDownload.downloadOp.supportsAcceptRanges).toBe(true);
      expect(activeDownload.downloadOp.totalSize).toBe(responseBuf.length);
      expect(activeDownload.downloadOp.completedBytes).toBe(17);

      // responseHandler response.on('data') function calls
      expect(responseHandlerSpy).toHaveBeenCalled();

      // Don't know how many times write is called. Does not matter
      expect(write).toHaveBeenCalled();

      // responseCloseHandler function calls
      expect(renameFileSpy).toHaveBeenCalledTimes(1);

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(
        1,
        'finishedDownload',
        activeDownload.downloadOp.id,
      );
      expect(emitSpy).toHaveBeenNthCalledWith(2, 'downloadClosed');

      expect(activeDownload.downloadOp.status).toBe(DownloadStatus.Completed);

      expect(nock.isDone()).toBe(true);
    });
  });
});
