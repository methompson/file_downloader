import { isString } from '@metools/tcheck';

export function getURL() {
  const url = import.meta.env.VITE_API_URL;
  if (isString(url)) {
    return url;
  }

  throw new Error('No API URL specified');
}
