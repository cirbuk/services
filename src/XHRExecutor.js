import {
  isUndefined,
  isNull,
  isFunction,
  mapValues,
  isString,
  isPlainObject,
} from '@kubric/utils';
import Resolver from '@kubric/resolver';
import http from 'superagent';
import loggerPlugin from './logger';
import BaseExecutor from './BaseExecutor';

const isJSONResponse = ({type}) => type === 'application/json';

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

const createForm = (data) => {
  const formData = new FormData();
  mapValues(data, (value, field) => {
    formData.append(field, value);
  });
  return formData;
};

export default class XHRExecutor extends BaseExecutor {
  static responseCache = {};

  _addField(field, data) {
    if (Array.isArray(data)) {
      data.forEach((val) => this.request.field(field, val));
    } else if (typeof data === 'object') {
      this.request.field(field, JSON.stringify(data));
    } else {
      const finalData = isUndefined(data) ? '' : data;
      this.request.field(field, finalData);
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
      method = method === 'delete' ? 'del' : method;
      const url = this._resolveUrl(finalTriggerData);
      this.url = url;
      const request = http[method](url).query(
        this._resolveQuery(finalTriggerData)
      );
      this.request = request;

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
          request.set(header, value);
        });
      }

      let sendData =
        method === 'post' || method === 'put' || method === 'patch';
      let resolvedData;
      if (finalTriggerData) {
        resolvedData = mappingResolver.resolve(data, finalTriggerData);
        resolvedData =
          !isString(resolvedData) && deleteEmptyFields
            ? deleteUndefinedFields(resolvedData)
            : resolvedData;
        if (isFormData) {
          if (typeof window !== 'undefined') {
            data = createForm(resolvedData);
          } else {
            this._addFields(resolvedData, (field, value) =>
              this._addField(field, value)
            );
            data = {};
            sendData = false;
          }
        } else if (isURLEncoded) {
          Object.keys(resolvedData).forEach((key) => {
            const val = resolvedData[key];
            if (Array.isArray(val)) {
              val.forEach((value) =>
                request.send(`${key}=${getURLEncodedValue(value)}`)
              );
            } else {
              request.send(`${key}=${getURLEncodedValue(val)}`);
            }
          });
        } else {
          data = resolvedData;
        }
      }

      if (!isURLEncoded) {
        if (
          (method === 'post' || method === 'put' || method === 'patch') &&
          type === 'auto'
        ) {
          data = finalTriggerData;
          request.send(data);
        } else if (sendData) {
          request.send(data);
        }
      }

      request.on('progress', this._emit.bind(this, 'progress'));

      if (this.plugins.length > 0) {
        this.plugins.forEach((plugin) => request.use(plugin));
      }
      request.use(loggerPlugin(this.logOptions));
      return this;
    });
  }

  _fireRequest() {
    return new Promise((resolve, reject) => {
      this.request.end((err, response) => {
        if (!isUndefined(err) && !isNull(err)) {
          reject(err);
        } else {
          let resp = isJSONResponse(response) ? response.body : response.text;
          if (isFunction(this.responseTransformer)) {
            resp = this.responseTransformer(resp);
          }
          resolve(resp);
        }
      });
    });
  }
}
