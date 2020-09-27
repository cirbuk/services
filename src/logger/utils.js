import { isFunction, isString } from "@kubric/litedash";

const rightPad = (str, len) => {
  let l = str.length;
  if (l < len) {
    for (let i = 0, n = len - l; i < n; i++) {
      str += ' ';
    }
  }
  return str;
};

export const prefix = (timestamp, prefixer) => {
  let str = '';
  if (isFunction(prefixer)) {
    str = `[${prefixer()}] `;
  } else if (isString(prefixer) && prefixer.length > 0) {
    str = `[${prefixer}] `;
  }
  if (timestamp > 0) {
    str = `${str}[${timestamp}] `;
  }
  return str;
};

export const protocol = uri => rightPad(uri.protocol !== null ? uri.protocol.toUpperCase().replace(/\W/g, '') : '', 5);

export const method = req => rightPad(req.method.toUpperCase(), 5);

export const path = req => `${req.url}`;

export const status = res => rightPad(res.status, 7);

export const headers = req => `${rightPad("Headers", 5)}${rightPad(JSON.stringify(req.header), 12)}`;

export const body = res => `${rightPad("Body", 5)}${rightPad(JSON.stringify(res.body), 12)}`;

export const error = res => `${rightPad("Error", 5)}${rightPad(JSON.stringify(res.error), 12)}`;

export const errorStack = res => rightPad(res.error.stack, 12);