import {
  isUndefined,
  isFunction,
  mapValues,
  isString,
  isPlainObject,
} from '@kubric/utils';
import Resolver from '@kubric/resolver';
import fetchLoggerPlugin from './logger/fetch';
import BaseExecutor from './BaseExecutor';

const isJSONResponse = ({headers}) => {
  const contentType = headers.get('content-type') || '';
  return contentType.includes('application/json');
};

const getURLEncodedValue = (value) =>
  encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));

const deleteUndefinedFields = (data) => {
  const results = {...data};
  const keys = Object.keys(results);
  keys.forEach((i) => {
    typeof results[i] === 'undefined' && delete results[i];
  });
  return results;
};

const createURLEncodedBody = (data) => {
  const pairs = [];
  Object.keys(data).forEach((key) => {
    const val = data[key];
    if (Array.isArray(val)) {
      val.forEach((value) => {
        pairs.push(`${key}=${getURLEncodedValue(value)}`);
      });
    } else {
      pairs.push(`${key}=${getURLEncodedValue(val)}`);
    }
  });
  return pairs.join('&');
};

export default class FetchExecutor extends BaseExecutor {
  static responseCache = {};

  // eslint-disable-next-line class-methods-use-this
  _addField(field, data, formData) {
    if (Array.isArray(data)) {
      data.forEach((val) => formData.append(field, val));
    } else if (typeof data === 'object') {
      formData.append(field, JSON.stringify(data));
    } else {
      const finalData = isUndefined(data) ? '' : data;
      formData.append(field, finalData);
    }
  }

  _setupRequest(triggerData) {
    return this._getFinalTriggerData(triggerData).then((finalTriggerData) => {
      const mappingResolver = new Resolver();
      let {
        method = 'get',
        headers,
        data = {},
        type,
        isFormData = false,
        isURLEncoded = false,
        deleteEmptyFields = false,
      } = this.serviceConfig;
      // resolve method if it is a mapping string
      method = mappingResolver.resolve(method, finalTriggerData) || 'get';
      method = method.toLowerCase();
      const url = this._resolveUrl(finalTriggerData);
      this.url = url;
      const query = this._resolveQuery(finalTriggerData);

      // Build URL with query parameters
      let fullUrl = url;
      const queryParams = new URLSearchParams();
      if (query && Object.keys(query).length > 0) {
        Object.keys(query).forEach((key) => {
          const value = query[key];
          if (!isUndefined(value)) {
            if (Array.isArray(value)) {
              // Append each array element as a separate query parameter with the same name
              value.forEach((item) => {
                queryParams.append(key, item);
              });
            } else {
              queryParams.append(key, value);
            }
          }
        });
        const queryString = queryParams.toString();
        if (queryString) {
          fullUrl = `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
        }
      }

      // Setup headers
      const requestHeaders = new Headers();
      if (headers) {
        // resolve the headers object
        const resolvedHeaders = mappingResolver.resolve(
          headers,
          finalTriggerData
        );
        // if the headers key itself was a resolver mapping, the initial data propagation would've bound the mapping
        // to `__headers__` key which now is resolved The resolved object is now destructured to override the base
        // headers
        if (isPlainObject(resolvedHeaders.__headers__)) {
          Object.assign(resolvedHeaders, resolvedHeaders.__headers__);
        }

        // remove the custom mapping key
        // This is to be done even if resolving for the mapping failed.
        delete resolvedHeaders.__headers__;

        mapValues(resolvedHeaders, (value, header) => {
          requestHeaders.set(header, value);
        });
      }

      // Setup request options
      const requestOptions = {
        method: method.toUpperCase(),
        headers: requestHeaders,
      };

      const sendData =
        method === 'post' || method === 'put' || method === 'patch';
      let resolvedData;
      if (finalTriggerData) {
        resolvedData = mappingResolver.resolve(data, finalTriggerData);
        resolvedData =
          !isString(resolvedData) && deleteEmptyFields
            ? deleteUndefinedFields(resolvedData)
            : resolvedData;
        if (isFormData) {
          const formData = new FormData();
          if (
            (this.includeFieldsArr && this.includeFieldsArr.length > 0) ||
            (this.avoidFieldsArr && this.avoidFieldsArr.length > 0)
          ) {
            // Use field filtering if includeFields or avoidFields are set
            this._addFields(resolvedData, (field, value) =>
              this._addField(field, value, formData)
            );
          } else {
            // Otherwise, add all fields
            mapValues(resolvedData, (value, field) => {
              this._addField(field, value, formData);
            });
          }
          requestOptions.body = formData;
        } else if (isURLEncoded) {
          requestOptions.body = createURLEncodedBody(resolvedData);
          requestHeaders.set(
            'Content-Type',
            'application/x-www-form-urlencoded'
          );
        } else if (
          (method === 'post' || method === 'put' || method === 'patch') &&
          type === 'auto'
        ) {
          requestOptions.body = JSON.stringify(finalTriggerData);
          if (!requestHeaders.has('Content-Type')) {
            requestHeaders.set('Content-Type', 'application/json');
          }
        } else if (sendData) {
          if (isString(resolvedData)) {
            requestOptions.body = resolvedData;
          } else {
            requestOptions.body = JSON.stringify(resolvedData);
            if (!requestHeaders.has('Content-Type')) {
              requestHeaders.set('Content-Type', 'application/json');
            }
          }
        }
      }

      // Store request info for logging and plugins
      this.requestInfo = {
        method: method.toUpperCase(),
        url: fullUrl,
        headers: requestHeaders,
        body: requestOptions.body,
      };

      // Apply plugins (transform request options)
      if (this.plugins.length > 0) {
        this.plugins.forEach((plugin) => {
          if (isFunction(plugin)) {
            const result = plugin(this.requestInfo);
            if (result && typeof result === 'object') {
              Object.assign(requestOptions, result);
            }
          }
        });
      }

      // Apply logger
      const logger = fetchLoggerPlugin(this.logOptions);
      if (logger && isFunction(logger.request)) {
        logger.request(this.requestInfo);
      }

      this.requestOptions = requestOptions;
      this.fullUrl = fullUrl;
      this.logger = logger;
      return this;
    });
  }

  _fireRequest() {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      this.requestOptions.signal = controller.signal;
      this.abortController = controller;

      // Handle progress events if there's a body and progress handlers
      if (this.requestOptions.body && this.eventHandlers.progress) {
        // For progress tracking, we need to track upload progress
        // This is a simplified version - full implementation would require
        // tracking the body stream
        const progressHandlers = this.eventHandlers.progress || [];
        if (progressHandlers.length > 0) {
          // Emit initial progress event
          progressHandlers.forEach((handler) => {
            setImmediate(() => handler({loaded: 0, total: 0}));
          });
        }
      }

      const responsePromise = fetch(this.fullUrl, this.requestOptions)
        .then(async (response) => {
          // Handle download progress if there are progress handlers
          if (this.eventHandlers.progress && response.body) {
            const reader = response.body.getReader();
            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;
            const chunks = [];
            const progressHandlers = this.eventHandlers.progress || [];

            // eslint-disable-next-line no-constant-condition
            while (true) {
              const {done, value} = await reader.read();
              if (done) break;
              chunks.push(value);
              loaded += value.length;
              const currentLoaded = loaded;
              progressHandlers.forEach((handler) => {
                setImmediate(() => handler({loaded: currentLoaded, total}));
              });
            }

            // Reconstruct the response with the read body
            const blob = new Blob(chunks);
            const newResponse = new Response(blob, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            return newResponse;
          }

          return response;
        })
        .then(async (response) => {
          let resp;
          if (isJSONResponse(response)) {
            try {
              resp = await response.json();
            } catch {
              resp = await response.text();
            }
          } else {
            resp = await response.text();
          }

          // Apply logger response with the parsed body
          if (this.logger && isFunction(this.logger.response)) {
            this.logger.response(response, this.requestInfo, resp);
          }

          if (!response.ok) {
            const error = new Error(
              `HTTP ${response.status}: ${response.statusText}`
            );
            error.status = response.status;
            error.response = resp;
            throw error;
          }

          if (isFunction(this.responseTransformer)) {
            resp = this.responseTransformer(resp);
          }
          return resp;
        })
        .catch((err) => {
          // Apply logger error if available
          if (this.logger && isFunction(this.logger.error)) {
            this.logger.error(err, this.requestInfo);
          }
          throw err;
        });

      responsePromise
        .then((resp) => {
          resolve(resp);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
    return this;
  }
}
