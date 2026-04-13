import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsEvents } from '@libs/contracts';
import { WsExceptionFilter } from './ws-exception.filter';

describe('WsExceptionFilter', () => {
  const emit = jest.fn();
  const host = {
    switchToWs: () => ({
      getClient: () => ({ emit }),
    }),
  } as unknown as ArgumentsHost;

  let filter: WsExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new WsExceptionFilter();
  });

  it('should emit structured ws:error payload for WsException objects', () => {
    filter.catch(
      new WsException({ code: 'FORBIDDEN', message: 'Forbidden', details: [] }),
      host,
    );

    expect(emit).toHaveBeenCalledWith(
      WsEvents.WsError,
      expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'Forbidden',
      }),
    );
  });

  it('should map HttpException validation arrays into bad request payload', () => {
    filter.catch(new BadRequestException(['body must be shorter']), host);

    expect(emit).toHaveBeenCalledWith(
      WsEvents.WsError,
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Validation failed',
        details: ['body must be shorter'],
      }),
    );
  });

  it('should not leak raw internal error messages', () => {
    filter.catch(new Error('db secret failure'), host);

    expect(emit).toHaveBeenCalledWith(
      WsEvents.WsError,
      expect.objectContaining({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
    );
  });
});
