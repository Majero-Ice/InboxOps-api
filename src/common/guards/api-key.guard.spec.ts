import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

function createContext(apiKey?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: apiKey === undefined ? {} : { 'x-api-key': apiKey },
      }),
    }),
  } as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const guard = new ApiKeyGuard({
    getOrThrow: (key: string) => {
      if (key === 'SERVICE_API_KEY') {
        return 'expected-secret-key';
      }
      throw new Error(`Missing config: ${key}`);
    },
  } as ConfigService);

  it('allows requests with a valid API key', () => {
    expect(guard.canActivate(createContext('expected-secret-key'))).toBe(true);
  });

  it('rejects requests with a missing API key', () => {
    expect(() => guard.canActivate(createContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects requests with an invalid API key', () => {
    expect(() => guard.canActivate(createContext('wrong-key'))).toThrow(
      UnauthorizedException,
    );
  });
});
