import {isPlainObject, isValidString} from "@kubric/utils";
import Resolver from '@kubric/resolver';

import Executor from './Executor';

const getPath = (currentPath, toBeAdded = '', defaultToAdd = '') => {
  if (toBeAdded) {
    return /^\/.*/.test(toBeAdded) ? toBeAdded : `${currentPath}/${toBeAdded}`;
  } else {
    return `${currentPath}${defaultToAdd}`;
  }
};

export default class Services {
  constructor(config, options) {
    this.config = config;
    this.setOptions(options);
    this.services = {};
  }

  getServices() {
    return this.services;
  }

  setOptions(options) {
    this.options = options;
  }

  setOption(option, value) {
    this.options[option] = value;
  }

  generate() {
    const { config } = this;
    let path = getPath('', config.path, '/');
    let host = config.host || '';
    let headers = config.headers || {};
    let query = config.query || {};
    let services = {};
    Object.keys(config.resources)
      .forEach(resource => {
        let resourceConf = config.resources[resource];
        let resourceServices = services[resource] = {};
        let resourcePath = getPath(path, resourceConf.path, '');
        let resourceHost = resourceConf.host || host;
        let resourceHeaders = {
          ...headers,
          // Note: for this top level headers, resolver mapping support is not enabled for now.
          ...(resourceConf.headers || {}),
        };
        let resourceQuery = {
          ...query,
          ...(resourceConf.query || {}),
        };
        if (resourceConf.services) {
          Object.keys(resourceConf.services)
            .forEach(service => {
              let serviceConf = resourceConf.services[service];
              let servicePath = getPath(resourcePath, serviceConf.path, '');
              serviceConf.host = serviceConf.host || resourceHost;

              let serviceConfHeaders;
              // for when headers have resolver mapping
              if (isValidString(serviceConf.headers)) {
                  // create a resolvable object for resolving at runtime when send() is invoked
                  if (Resolver.hasAnyMapping(serviceConf.headers)) {
                      serviceConfHeaders = {
                            "__headers__": serviceConf.headers
                      }
                  }
                  // if it's not a valid mapping, ignore it as headers should be either an object or a resolvable mapping string
              } else {
                  serviceConfHeaders = serviceConf.headers
              }

              serviceConf.headers = {
                ...resourceHeaders,
                ...(serviceConfHeaders || {}),
              };
              const serviceQuery = serviceConf.query || {};
              serviceConf.query = isPlainObject(serviceQuery) ? {
                ...resourceQuery,
                ...serviceQuery,
              } : [resourceQuery, serviceQuery];
              resourceServices[service] = serviceOptions => new Executor(servicePath, serviceConf, {
                configPath: `${resource}.${service}`,
                global: this.options,
                service: serviceOptions
              });
            });
        }

        if (!resourceServices.get) {
          resourceServices.get = serviceOptions => new Executor(resourcePath, {
            method: 'get',
            type: 'auto',
            host: resourceHost,
            headers: resourceHeaders,
            query: resourceQuery,
          }, {
            configPath: `${resource}.get`,
            global: this.options,
            service: serviceOptions
          });
        }

        if (!resourceServices.save) {
          resourceServices.save = serviceOptions => new Executor(resourcePath, {
            method: 'post',
            type: 'auto',
            host: resourceHost,
            headers: resourceHeaders,
            query: resourceQuery,
          }, {
            configPath: `${resource}.save`,
            global: this.options,
            service: serviceOptions
          });
        }

        if (!resourceServices.delete) {
          resourceServices.delete = serviceOptions => new Executor(resourcePath, {
            method: 'delete',
            type: 'auto',
            host: resourceHost,
            headers: resourceHeaders,
            query: resourceQuery,
          }, {
            configPath: `${resource}.delete`,
            global: this.options,
            service: serviceOptions
          });
        }
      });
    this.services = services;
    return this.services;
  }
}
