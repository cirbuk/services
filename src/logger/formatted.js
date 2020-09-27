import chalk from "chalk";
import { protocol, method, path, errorStack, error, headers, body, prefix } from "./utils";

const colorForSpeed = ms => {
  if (ms < 200) {
    return 'green';
  } else if (ms < 1000) {
    return 'gray';
  } else if (ms < 5000) {
    return 'yellow';
  } else {
    return 'red';
  }
};

export default (logger, req, uri, { verbose = false, timestamp = false, prefix: prefixFn }) => {
  const start = new Date().getTime();
  const prefixStr = prefix(timestamp && start, prefixFn);

  return {
    request() {
      logger.info('%s %s %s %s %s', prefixStr, protocol(uri), method(req), path(req), chalk.gray('(pending)'));
    },
    response(res) {
      const now = new Date().getTime();
      const elapsed = now - start;

      let st = res.status;
      if (st < 300) {
        st = chalk.green(st);
      } else if (st < 400) {
        st = chalk.yellow(st);
      } else {
        st = chalk.red(st);
      }

      logger.info('%s %s %s %s %s %s', prefixStr, chalk.magenta(protocol(uri)), chalk.cyan(method(req)), st, path(req), `${chalk.gray('(')}${chalk[colorForSpeed(elapsed)](elapsed + 'ms')}${chalk.gray(')')}`);
      const hasErred = res.status >= 400;
      if (verbose || hasErred) {
        const colorFn = hasErred ? chalk.red.bind(chalk) : chalk.gray.bind(chalk);
        logger.info('%s %s', prefixStr, colorFn(headers(req)));
        logger.info('%s %s', prefixStr, colorFn(body(res)));
        if (res.error) {
          logger.error('%s %s', prefixStr, colorFn(error(res)));
          logger.error('%s %s', prefixStr, colorFn(errorStack(res)));
        }
      }
    }
  };
}