import formatted from './formatted';
import unformatted from './unformatted';

const messagers = {
  formatted,
  unformatted,
};

const getUrl = (url) => {
  if (!url || !url.startsWith('http')) {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-undef
      url = `${window.location.origin}${url || ''}`;
    } else {
      return {};
    }
  }
  try {
    return new URL(url);
  } catch (e) {
    return {};
  }
};

// Convert Headers object to plain object
const headersToObject = (headers) => {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const obj = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    return headers;
  }
  return {};
};

const attachFetchLogger = (options, requestInfo) => {
  const {
    logger = console,
    format = true,
    outgoing,
    verbose = false,
    timestamp = false,
    prefix,
  } = options;
  const uri = getUrl(requestInfo.url);
  
  // Create a superagent-compatible request object for the logger
  const logRequest = {
    method: requestInfo.method || 'GET',
    url: requestInfo.url,
    header: headersToObject(requestInfo.headers),
  };

  const messager = messagers[format ? 'formatted' : 'unformatted'](
    logger,
    logRequest,
    uri,
    {
      verbose,
      timestamp,
      prefix,
    }
  );

  return {
    request() {
      outgoing && messager.request();
    },
    async response(response, requestInfo, parsedBody = null) {
      // Convert fetch Response to a logger-compatible format
      let responseBody = parsedBody;
      if (responseBody === null) {
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            responseBody = await response.clone().json();
          } else {
            responseBody = await response.clone().text();
          }
        } catch (e) {
          // Ignore body parsing errors
        }
      }

      const logResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: responseBody,
        error: response.status >= 400 ? new Error(response.statusText) : null,
      };
      messager.response(logResponse);
    },
    error(error, requestInfo) {
      const logResponse = {
        status: error.status || 0,
        statusText: error.message || 'Network Error',
        headers: new Headers(),
        body: error.response || null,
        error: error,
      };
      messager.response(logResponse);
    },
  };
};

export default (options = {}) => {
  if (options && typeof options === 'object' && 'url' in options) {
    // Called with requestInfo directly
    return attachFetchLogger({}, options);
  }
  // Return a function that will be called with requestInfo
  return attachFetchLogger.bind(null, options);
};
