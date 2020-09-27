import { isUndefined, isNull, isFunction, mapValues, isString, isValidString } from "@kubric/litedash";
import { getTypes, getActions } from "@bit/kubric.redux.reducks.utils";
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
  static store;
  static actionPrefix;

  static validateOptions({ store } = {}) {
    if (!isUndefined(store) && !isFunction(store.dispatch)) {
      throw new Error("Invalid store instance passed. No dispatch method found");
    }
  }

  constructor(servicePath, serviceConf, { global = {}, service = {} } = {}) {
    this.globalOptions = global;
    const { actionPrefix: gActionPrefix = '', plugins: gPlugins = [], logs: gLogOptions = {}, transformers: { input: gInputTransformer, response: gResponseTransformer } = {} } = global;
    this.actionPrefix = gActionPrefix;
    let { actionPrefix: sActionPrefix = '', actions, logs: sLogOptions = {}, transformers: { input: sInputTransformer, response: sResponseTransformer } = {} } = service;
    this.logOptions = {
      ...gLogOptions,
      ...sLogOptions
    };
    this.inputTransformer = isFunction(sInputTransformer) ? sInputTransformer : gInputTransformer;
    this.responseTransformer = isFunction(sResponseTransformer) ? sResponseTransformer : gResponseTransformer;
    const aPrefix = sActionPrefix || gActionPrefix;
    this.servicePath = servicePath;
    this.serviceConfig = serviceConf;
    this.eventHandlers = {};
    this.plugins = [ ...gPlugins ];
    this.storeKey = serviceConf.storeKey || '';
    this.actionPrefix = `${(aPrefix.length > 0 ? `${aPrefix}/` : '')}${this.storeKey}`;
    if (!isUndefined(actions)) {
      this.actions = actions;
    } else {
      this.actions = getActions(getTypes([
        'INITIATED',
        'COMPLETED',
        'FAILED',
        'PROGRESSED',
      ], this.actionPrefix));
    }
  }

  getStore() {
    const { store, getStore } = this.globalOptions;
    return store || getStore();
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

  _setupRequest(triggerData) {
    if (isFunction(this.inputTransformer)) {
      triggerData = this.inputTransformer(triggerData);
    }
    const mappingResolver = new Resolver();
    let { method = 'get', query = '', headers, data = {}, type, isFormData = false, isURLEncoded = false, deleteEmptyFields = false, storeKey } = this.serviceConfig;
    method = method.toLowerCase();
    method = (method === 'delete' ? 'del' : method);
    const url = this.url = this._resolveUrl(triggerData);
    const request = this.request = http[method](url)
      .query(mappingResolver.resolve(query, triggerData));
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
        data = Object.keys(resolvedData).forEach(key => {
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

  _progressHandler(progressData = {}, e) {
    const store = this.getStore();
    store && store.dispatch(this.actions.progressed({
      ...progressData,
      progressPercent: e.percent,
    }));
  }

  send(serviceData, { extraData = {} } = {}) {
    this._setupRequest(serviceData);
    if (this.shouldNotifyStore) {
      const actionPayload = {
        serviceData,
        extraData,
      };
      const store = this.getStore();
      store && store.dispatch(this.actions.initiated(actionPayload));
      if (this.shouldNotifyProgress) {
        this.request.on('progress', this._progressHandler.bind(this, actionPayload));
      }
      return this._fireRequest()
        .then(response => {
          let payload = {
            ...actionPayload,
            response,
          };
          store && store.dispatch(this.actions.completed(payload));
          return response;
        })
        .catch(err => {
          store && store.dispatch(this.actions.failed({
            ...actionPayload,
            err: (err.response && err.response.body) || undefined,
            status: err.status,
          }));
          throw err;
        })
    } else {
      return this._fireRequest();
    }
  }

  notifyStore(shouldNotify = true) {
    this.shouldNotifyStore = shouldNotify;
    return this;
  }

  notifyProgress(shouldNotify = true) {
    this.shouldNotifyProgress = shouldNotify;
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