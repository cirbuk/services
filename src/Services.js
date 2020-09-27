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
    Executor.validateOptions(options);
    this.options = options;
  }

  setOption(option, value) {
    const proposedOptions = {
      ...(this.options || {}),
      [option]: value
    };
    Executor.validateOptions(proposedOptions);
    this.options[option] = value;
  }

  generate() {
    const {config} = this;
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
              serviceConf.headers = {
                ...resourceHeaders,
                ...(serviceConf.headers || {}),
              };
              serviceConf.query = {
                ...resourceQuery,
                ...(serviceConf.query || {}),
              };
              resourceServices[service] = serviceOptions => new Executor(servicePath, serviceConf, {
                global: this.options,
                service: serviceOptions
              });
              if (serviceConf.storeKey) {
                resourceServices[service].storeKey = serviceConf.storeKey;
              }
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
            global: this.options,
            service: serviceOptions
          });
        }
      });
    this.services = services;
    return this.services;
  }
}
