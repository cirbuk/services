import {
  isUndefined,
  isNull,
  isFunction,
  mapValues,
  isString,
  isValidString,
  isPlainObject,
  isNullOrUndefined,
} from '@kubric/utils';
import Resolver from '@kubric/resolver';
import http from 'superagent';
import loggerPlugin from './logger';

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

export default class Executor {
  static responseCache = {};

  constructor(
    servicePath,
    serviceConf,
    {configPath, global = {}, service = {}} = {}
  ) {
    this.globalOptions = global;
    this.configPath = configPath;
    const {
      plugins: gPlugins = [],
      logs: gLogOptions = {},
      transformers: {
        input: gInputTransformer,
        response: gResponseTransformer,
      } = {},
    } = global;
    const {
      logs: sLogOptions = {},
      transformers: {
        input: sInputTransformer,
        response: sResponseTransformer,
      } = {},
    } = service;
    this.logOptions = {
      ...gLogOptions,
      ...sLogOptions,
    };
    this.inputTransformer = isFunction(sInputTransformer)
      ? sInputTransformer
      : gInputTransformer;
    this.responseTransformer = isFunction(sResponseTransformer)
      ? sResponseTransformer
      : gResponseTransformer;
    this.servicePath = servicePath;
    this.serviceConfig = serviceConf;
    this.eventHandlers = {};
    this.plugins = [...gPlugins];
  }

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

  _addFields(data) {
    const {
      includeFieldsArr: includeFields = [],
      avoidFieldsArr: avoidFields = [],
    } = this;
    if (includeFields.length > 0) {
      const includeSet = new Set(includeFields);
      mapValues(data, (value, field) => {
        if (includeSet.has(field)) {
          this._addField(field, value);
        }
      });
    } else {
      const avoidSet = new Set(avoidFields);
      mapValues(data, (value, field) => {
        if (!avoidSet.has(field)) {
          this._addField(field, value);
        }
      });
    }
  }

  getUrl(triggerData) {
    const {query = {}} = this.serviceConfig;
    const mappingResolver = new Resolver();
    const resolvedQuery = mappingResolver.resolve(query, triggerData);
    const queries = Object.keys(query);
    return queries.reduce((acc, query, index) => {
      const value = resolvedQuery[query];
      const hasValue = !isUndefined(value);
      const lastIndex = index === queries.length - 1;
      return `${acc}${index === 0 ? '?' : ''}${
        hasValue ? `${query}=${resolvedQuery[query]}` : ''
      }${hasValue && !lastIndex ? '&' : ''}`;
    }, this._resolveUrl(triggerData));
  }

  _resolveUrl(triggerData) {
    const pathResolver = new Resolver({
      replaceUndefinedWith: '',
    });
    const {host = ''} = this.serviceConfig;
    let url = this.overridenUrl
      ? this.overridenUrl
      : pathResolver.resolve(`${host}${this.servicePath}`, triggerData);
    url = url.replace(/\/$/, '');
    url = url.replace(/([^:/])[/]+/g, '$1/');
    if (this.shouldForceSecure) {
      url = url.replace(/^https?/, 'https');
    }
    return url;
  }

  _resolveQuery(triggerData) {
    const {query = {}} = this.serviceConfig;
    const resolver = new Resolver();
    const resolvedQuery = resolver.resolve(query, triggerData);
    return Array.isArray(resolvedQuery)
      ? resolvedQuery.reduce(
          (acc, queryPart) => ({
            ...acc,
            ...queryPart,
          }),
          {}
        )
      : resolvedQuery;
  }

  _getFinalTriggerData(triggerData) {
    let finalTriggerData = triggerData;
    if (isFunction(this.inputTransformer)) {
      finalTriggerData = this.inputTransformer(finalTriggerData);
    }
    if (
      !isNullOrUndefined(finalTriggerData) &&
      isFunction(finalTriggerData.then)
    ) {
      return finalTriggerData;
    }
    return Promise.resolve(finalTriggerData);
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
            this._addFields(resolvedData);
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

  cacheResponse(response, isErred = false) {
    Executor.responseCache[this.cacheKey] = {
      response,
      isErred,
    };
  }

  send(serviceData) {
    const cacheEnabled = isValidString(this.cacheKey);
    if (cacheEnabled) {
      const {response, isErred = false} =
        Executor.responseCache[this.cacheKey] || {};
      if (!isUndefined(response)) {
        if (isFunction(response.then)) {
          return response;
        }
        return isErred ? Promise.reject(response) : Promise.resolve(response);
      }
    }
    const promise = this._setupRequest(serviceData).then(() =>
      this._fireRequest()
        .then((resp) => {
          this.cacheResponse(resp);
          return resp;
        })
        .catch((err) => {
          this.cacheResponse(err, true);
          throw err;
        })
    );
    this.cacheResponse(promise);
    return promise;
  }

  cache(cacheKey = '') {
    this.cacheKey = `${this.configPath}${
      isValidString(cacheKey) ? `:${cacheKey}` : ''
    }`;
    return this;
  }

  forceSecure(shouldForce = true) {
    this.shouldForceSecure = shouldForce;
    return this;
  }

  includeFields(fields = []) {
    this.includeFieldsArr = fields;
    return this;
  }

  avoidFields(fields = []) {
    this.avoidFieldsArr = fields;
    return this;
  }

  overrideUrl(url) {
    if (!isUndefined(url) && isValidString(url)) {
      this.overridenUrl = url;
      return this;
    }
    throw new Error('Invalid override url provided');
  }

  plugin(plugin) {
    const plugins = this.plugins || [];
    plugins.push(plugin);
    this.plugins = plugins;
    return this;
  }

  transform(transformer, type = 'response') {
    if (type === 'response') {
      this.responseTransformer = transformer;
    } else if (type === 'input') {
      this.inputTransformer = transformer;
    }
    return this;
  }

  on(event, handler) {
    let eventHandlers = this.eventHandlers[event];
    if (isUndefined(eventHandlers)) {
      eventHandlers = [];
    }
    eventHandlers.push(handler);
    this.eventHandlers[event] = eventHandlers;
    return this;
  }

  off(event, handler) {
    let eventHandlers = this.eventHandlers[event];
    if (!isUndefined(eventHandlers) && eventHandlers.length > 0) {
      if (isUndefined(handler)) {
        eventHandlers = [];
      } else {
        eventHandlers = eventHandlers.filter(
          (registered) => registered !== handler
        );
      }
    }
    this.eventHandlers[event] = eventHandlers;
    return this;
  }

  _emit(event, e) {
    const eventHandlers = this.eventHandlers[event];
    if (!isUndefined(eventHandlers) && eventHandlers.length > 0) {
      eventHandlers.forEach((handler) => setImmediate(handler, e));
    }
  }
}
