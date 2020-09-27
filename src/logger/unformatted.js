import { method, protocol, path, headers, body, error, errorStack, status, prefix } from "./utils";

export default (logger, req, uri, { verbose = false, timestamp = false, prefix: prefixFn }) => {
  const start = new Date().getTime();
  const prefixStr = prefix(timestamp && start, prefixFn);
  return {
    request() {
      logger.info(`${prefixStr}${protocol(uri)} ${method(req)} ${path(req)} (pending)`);
    },
    response(res) {
      const now = new Date().getTime();
      const elapsed = now - start;
      logger.info(`${prefixStr}${protocol(uri)} ${method(req)} ${status(res)} ${path(req)} (${elapsed})ms`);

      const hasErred = res.status >= 400;
      if (verbose || hasErred) {
        logger.info(`${prefixStr}${headers(req)}`);
        logger.info(`${prefixStr}${body(res)}`);
        if (res.error) {
          logger.error(`${prefixStr}${error(res)}`);
          logger.error(`${prefixStr}${errorStack(res)}`);
        }
      }
    }
  };
}