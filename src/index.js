import Services from './Services';
import { isUndefined, isFunction, isPlainObject, isNull } from '@kubric/utils';
import Resolver from '@kubric/resolver';
import transformers from './transformers';

const resolver = new Resolver({
  ignoreUndefined: true
});

export { default as Services } from "./Services";

export class Manager {
  static initialized = false;

  constructor({ ref, config, ...options } = {}) {
    if (isUndefined(ref) && !isPlainObject(config)) {
      throw new Error(`Either "ref" or "config"(service configuration) should be provided`);
    } else if (!isUndefined(ref) && !isFunction(ref.on)) {
      throw new Error(`"ref" should a valid firebase reference.`);
    }
    this.servicesRef = ref;
    this.config = config;
    const { init: initConfig = {}, transformers: customTransformers = {}, services: servicesOptions = {}, logs = {} } = options;
    const { key = '__init__', data = {} } = initConfig;
    this.initKey = key;
    this.transformers = {
      ...transformers,
      ...customTransformers
    };
    this.initData = {
      [this.initKey]: {
        ...data
      }
    };
    this.logOptions = logs;
    this.servicesOptions = servicesOptions;
    this.services = {};
  }

  setServices() {
    const config = this.config;
    const { logger } = this.logOptions;
    const serviceDef = resolver.resolve(config, this.initData, {
      mappers: [[/\[\[(.+?)]]/, (match, formula) => this.transformers[formula] || this.transformers['default']]]
    });
    this.servicesInstance = new Services(serviceDef, this.servicesOptions);
    const services = this.servicesInstance.generate();
    Object.assign(this.services, services);
    if (!isUndefined(logger) && isFunction(logger.info)) {
      logger.info("Services config updated from firebase");
      logger.info(config);
    }
  }

  init() {
    if (this.servicesRef) {
      return new Promise((resolve, reject) => {
        const handler = snap => {
          const data = snap.val();
          if (!isNull(data)) {
            this.config = data;
            this.setServices();
          } else if (!Manager.initialized) {
            //If null data is found during initialization
            reject(new Error("No firebase service configuration found to initialize services."));
            this.servicesRef.off("value", handler);
            return;
          }
          if (!Manager.initialized) {
            Manager.initialized = true;
            resolve();
          }
        };
        this.servicesRef
          .on('value', handler);
      })
    } else {
      this.setServices();
      return Promise.resolve();
    }
  }
}