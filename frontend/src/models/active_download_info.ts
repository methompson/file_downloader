import { isNumber, isString, typeGuardGenerator } from '@metools/tcheck';

export interface ActiveDownloadInfo {
  id: string;
  currentSpeed: number;
}

export const isActiveDownloadInfo = typeGuardGenerator<ActiveDownloadInfo>({
  id: isString,
  currentSpeedn: isNumber,
});
