import {
  isUndefined,
  isFunction,
  isValidString,
  isNullOrUndefined,
  mapValues,
} from '@kubric/utils';
import Resolver from '@kubric/resolver';

export default class BaseExecutor {
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

  _addFields(data, addFieldCallback) {
    const {
      includeFieldsArr: includeFields = [],
      avoidFieldsArr: avoidFields = [],
    } = this;
    if (includeFields.length > 0) {
      const includeSet = new Set(includeFields);
      mapValues(data, (value, field) => {
        if (includeSet.has(field)) {
          addFieldCallback(field, value);
        }
      });
    } else {
      const avoidSet = new Set(avoidFields);
      mapValues(data, (value, field) => {
        if (!avoidSet.has(field)) {
          addFieldCallback(field, value);
        }
      });
    }
  }

  cacheResponse(response, isErred = false) {
    const ExecutorClass = this.constructor;
    ExecutorClass.responseCache[this.cacheKey] = {
      response,
      isErred,
    };
  }

  send(serviceData) {
    const cacheEnabled = isValidString(this.cacheKey);
    if (cacheEnabled) {
      const ExecutorClass = this.constructor;
      const {response, isErred = false} =
        ExecutorClass.responseCache[this.cacheKey] || {};
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
