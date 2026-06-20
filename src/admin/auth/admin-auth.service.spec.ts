import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const config: Record<string, string> = {
                ADMIN_PASSWORD: 'correct-password',
                ADMIN_JWT_SECRET: 'test-jwt-secret',
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(AdminAuthService);
  });

  it('returns a token for the correct password', () => {
    const result = service.login('correct-password');

    expect(result.token).toBeDefined();
    const payload = jwt.verify(result.token, 'test-jwt-secret') as {
      sub: string;
    };
    expect(payload.sub).toBe('admin');
  });

  it('rejects an incorrect password', () => {
    expect(() => service.login('wrong-password')).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a token issued by login', () => {
    const { token } = service.login('correct-password');
    expect(() => service.verifyToken(token)).not.toThrow();
  });

  it('rejects an invalid token', () => {
    expect(() => service.verifyToken('not-a-token')).toThrow(
      UnauthorizedException,
    );
  });
});
