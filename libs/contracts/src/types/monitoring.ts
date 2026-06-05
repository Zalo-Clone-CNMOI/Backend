/** NestJS log levels — canonical source for both BFF validation and ai-core LogQL injection guard. */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  LOG = 'LOG',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE',
}
