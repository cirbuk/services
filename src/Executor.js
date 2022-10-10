import { isUndefined, isNull, isFunction, mapValues, isString, isValidString } from "@kubric/utils";
import Resolver from '@kubric/resolver';
import http from 'superagent';
import loggerPlugin from "./logger";

const isJSONResponse = ({ type }) => type === 'application/json';

const getURLEncodedValue = value => encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));

const deleteUndefinedFields = data => {
  const results = { ...data };
  for (let i in results) {
    typeof results[i] === 'undefined' && (delete results[i]);
  }
  return results;
};

const createForm = data => {
  const formData = new FormData();
  mapValues(data, (value, field) => {
    formData.append(field, value);
  });
  return formData;
};

export default class Executor {
  static responseCache = {};

  constructor(servicePath, serviceConf, { configPath, global = {}, service = {} } = {}) {
    this.globalOptions = global;
    this.configPath = configPath;
    const {
      plugins: gPlugins = [],
      logs: gLogOptions = {},
      transformers: { input: gInputTransformer, response: gResponseTransformer } = {}
    } = global;
    let {
      logs: sLogOptions = {},
      transformers: { input: sInputTransformer, response: sResponseTransformer } = {}
    } = service;
    this.logOptions = {
      ...gLogOptions,
      ...sLogOptions
    };
    this.inputTransformer = isFunction(sInputTransformer) ? sInputTransformer : gInputTransformer;
    this.responseTransformer = isFunction(sResponseTransformer) ? sResponseTransformer : gResponseTransformer;
    this.servicePath = servicePath;
    this.serviceConfig = serviceConf;
    this.eventHandlers = {};
    this.plugins = [...gPlugins];
  }

  _addField(field, data) {
    if (Array.isArray(data)) {
      data.forEach(val => this.request.field(field, val));
    } else if (typeof data === 'object') {
      this.request.field(field, JSON.stringify(data));
    } else {
      data = isUndefined(data) ? '' : data;
      this.request.field(field, data);
    }
  };

  _addFields(data) {
    const { includeFieldsArr: includeFields = [], avoidFieldsArr: avoidFields = [] } = this;
    if (includeFields.length > 0) {
      const includeSet = new Set(includeFields);
      mapValues(data, (value, field) => {
        if (includeSet.has(field)) {
          this._addField(field, value)
        }
      });
    } else {
      const avoidSet = new Set(avoidFields);
      mapValues(data, (value, field) => {
        if (!avoidSet.has(field)) {
          this._addField(field, value)
        }
      });
    }
  };

  getUrl(triggerData) {
    const { query = {} } = this.serviceConfig;
    const mappingResolver = new Resolver();
    const resolvedQuery = mappingResolver.resolve(query, triggerData);
    const queries = Object.keys(query);
    return queries.reduce((acc, query, index) => {
      const value = resolvedQuery[query];
      const hasValue = !isUndefined(value);
      const lastIndex = index === (queries.length - 1);
      return `${acc}${index === 0 ? '?' : ''}${hasValue ? `${query}=${resolvedQuery[query]}` : ''}${(hasValue && !lastIndex) ? '&' : ''}`;
    }, this._resolveUrl(triggerData));
  }


  _resolveUrl(triggerData) {
    const pathResolver = new Resolver({
      replaceUndefinedWith: '',
    });
    let { host = '' } = this.serviceConfig;
    let url = this.overridenUrl ? this.overridenUrl : (pathResolver.resolve(`${host}${this.servicePath}`, triggerData));
    url = url.replace(/\/$/, '');
    url = url.replace(/([^:\/])[\/]+/g, '$1/');
    if (this.shouldForceSecure) {
      url = url.replace(/^https?/, 'https');
    }
    return url;
  };

  _resolveQuery(triggerData) {
    const { query = {} } = this.serviceConfig;
    const resolver = new Resolver();
    const resolvedQuery = resolver.resolve(query, triggerData);
    return Array.isArray(resolvedQuery) ? resolvedQuery.reduce((acc, queryPart) => ({
      ...acc,
      ...queryPart
    }), {}) : resolvedQuery;
  }

  _setupRequest(triggerData) {
    if (isFunction(this.inputTransformer)) {
      triggerData = this.inputTransformer(triggerData);
    }
    const mappingResolver = new Resolver();
    let {
      method = 'get',
      headers,
      data = {},
      type,
      isFormData = false,
      isURLEncoded = false,
      deleteEmptyFields = false
    } = this.serviceConfig;
    // resolve method if it is a mapping string
    method = mappingResolver.resolve(method, triggerData) || 'get';
    method = method.toLowerCase();
    method = (method === 'delete' ? 'del' : method);
    const url = this.url = this._resolveUrl(triggerData);
    const request = this.request = http[method](url)
      .query(this._resolveQuery(triggerData));
    if (headers) {
      let resolvedHeaders = mappingResolver.resolve(headers, triggerData);
      mapValues(resolvedHeaders, (value, header) => {
        request.set(header, value);
      });
    }
    let sendData = method === 'post' || method === 'put' || method === 'patch';
    let resolvedData;
    if (triggerData) {
      resolvedData = mappingResolver.resolve(data, triggerData);
      resolvedData = (!isString(resolvedData) && deleteEmptyFields) ? deleteUndefinedFields(resolvedData) : resolvedData;
      if (isFormData) {
        if (typeof window !== 'undefined') {
          data = createForm(resolvedData);
        } else {
          this._addFields(resolvedData);
          data = {};
          sendData = false;
        }
      } else if (isURLEncoded) {
        Object.keys(resolvedData).forEach(key => {
          const val = resolvedData[key];
          if (Array.isArray(val)) {
            val.forEach(value => request.send(`${key}=${getURLEncodedValue(value)}`));
          } else {
            request.send(`${key}=${getURLEncodedValue(val)}`);
          }
        });
      } else {
        data = resolvedData;
      }
    }

    if (!isURLEncoded) {
      if ((method === 'post' || method === 'put' || method === 'patch') && type === 'auto') {
        data = triggerData;
        request.send(data);
      } else if (sendData) {
        request.send(data);
      }
    }

    request.on('progress', this._emit.bind(this, 'progress'));

    if (this.plugins.length > 0) {
      this.plugins.forEach(plugin => request.use(plugin));
    }
    request.use(loggerPlugin(this.logOptions));
    return this;
  }

  _fireRequest() {
    return new Promise((resolve, reject) => {
      this.request
        .end((err, response) => {
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
      isErred
    }
  }

  send(serviceData) {
    const cacheEnabled = isValidString(this.cacheKey);
    if (cacheEnabled) {
      const { response, isErred = false } = Executor.responseCache[this.cacheKey] || {};
      if (!isUndefined(response)) {
        if (isFunction(response.then)) {
          return response;
        }
        return isErred ? Promise.reject(response) : Promise.resolve(response);
      }
    }
    this._setupRequest(serviceData);
    const promise = this._fireRequest()
      .then(resp => {
        this.cacheResponse(resp);
        return resp;
      }).catch(err => {
        this.cacheResponse(err, true);
        throw err;
      });
    this.cacheResponse(promise);
    return promise;
  }

  cache(cacheKey = "") {
    this.cacheKey = `${this.configPath}${isValidString(cacheKey) ? `:${cacheKey}` : ""}`;
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
    } else {
      throw new Error("Invalid override url provided");
    }
  }

  plugin(plugin) {
    const plugins = this.plugins || [];
    plugins.push(plugin);
    this.plugins = plugins;
    return this;
  }

  transform(transformer, type = "response") {
    if (type === "response") {
      this.responseTransformer = transformer;
    } else if (type === "input") {
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
        eventHandlers = eventHandlers.filter(registered => registered !== handler);
      }
    }
    this.eventHandlers[event] = eventHandlers;
    return this;
  }

  _emit(event, e) {
    let eventHandlers = this.eventHandlers[event];
    if (!isUndefined(eventHandlers) && eventHandlers.length > 0) {
      eventHandlers.forEach(handler => setImmediate(handler, e));
    }
  }
}