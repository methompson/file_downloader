import {
  isBoolean,
  isNumber,
  isString,
  isUndefinedOrNull,
  unionGuard,
} from '@metools/tcheck';

export const isStringOrUndefined = unionGuard(isString, isUndefinedOrNull);
export const isBooleanOrUndefined = unionGuard(isBoolean, isUndefinedOrNull);
export const isNumberOrUndefined = unionGuard(isNumber, isUndefinedOrNull);
