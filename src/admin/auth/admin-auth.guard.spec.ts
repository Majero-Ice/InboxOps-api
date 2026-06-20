import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';

function createContext(
  authorization?: string,
  isPublic = false,
): ExecutionContext {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;

  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
    reflector,
  } as unknown as ExecutionContext;
}

describe('AdminAuthGuard', () => {
  const adminAuthService = {
    verifyToken: jest.fn(),
  } as unknown as AdminAuthService;

  let guard: AdminAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;
    guard = new AdminAuthGuard(reflector, adminAuthService);
    jest.clearAllMocks();
  });

  it('allows public routes without a token', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(true);

    expect(
      guard.canActivate(createContext(undefined, true)),
    ).toBe(true);
    expect(adminAuthService.verifyToken).not.toHaveBeenCalled();
  });

  it('allows requests with a valid bearer token', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(false);

    expect(
      guard.canActivate(createContext('Bearer valid-token', false)),
    ).toBe(true);
    expect(adminAuthService.verifyToken).toHaveBeenCalledWith('valid-token');
  });

  it('rejects requests without authorization header', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(false);

    expect(() => guard.canActivate(createContext(undefined, false))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects requests with an invalid authorization scheme', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(false);

    expect(() =>
      guard.canActivate(createContext('Basic abc123', false)),
    ).toThrow(UnauthorizedException);
  });
});
