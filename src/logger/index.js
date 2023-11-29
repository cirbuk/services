import superagent from 'superagent';
import formatted from './formatted';
import unformatted from './unformatted';

const messagers = {
  formatted,
  unformatted,
};

const attachSuperagentLogger = (options, req) => {
  const {
    logger = console,
    format = true,
    outgoing,
    verbose = false,
    timestamp = false,
    prefix,
  } = options;
  const uri = new URL(req.url);
  const messager = messagers[format ? 'formatted' : 'unformatted'](
    logger,
    req,
    uri,
    {
      verbose,
      timestamp,
      prefix,
    }
  );

  outgoing && messager.request();

  req.on('response', (res) => messager.response(res));
};

export default (options = {}) =>
  options instanceof superagent.Request
    ? attachSuperagentLogger({}, options)
    : attachSuperagentLogger.bind(null, options);
