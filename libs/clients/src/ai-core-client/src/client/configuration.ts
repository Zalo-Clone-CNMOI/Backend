export interface ConfigurationParameters {
  basePath?: string;
  baseOptions?: unknown;
}

export class Configuration {
  basePath?: string;
  baseOptions?: unknown;

  constructor(param: ConfigurationParameters = {}) {
    this.basePath = param.basePath;
    this.baseOptions = param.baseOptions;
  }
}
