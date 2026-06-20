import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { LoginResult } from '../admin.types';

@Injectable()
export class AdminAuthService {
  constructor(private readonly configService: ConfigService) {}

  login(password: string): LoginResult {
    const expectedPassword =
      this.configService.getOrThrow<string>('ADMIN_PASSWORD');

    if (!this.constantTimeCompare(password, expectedPassword)) {
      throw new UnauthorizedException();
    }

    const secret = this.configService.getOrThrow<string>('ADMIN_JWT_SECRET');
    const token = jwt.sign({ sub: 'admin' } satisfies AdminTokenPayload, secret, {
      expiresIn: TOKEN_EXPIRY,
    });

    return { token };
  }

  verifyToken(token: string): void {
    try {
      const secret = this.configService.getOrThrow<string>('ADMIN_JWT_SECRET');
      const payload = jwt.verify(token, secret) as AdminTokenPayload;

      if (payload.sub !== 'admin') {
        throw new UnauthorizedException();
      }
    } catch {
      throw new UnauthorizedException();
    }
  }

  private constantTimeCompare(a: string, b: string): boolean {
    const hashA = createHash('sha256').update(a).digest();
    const hashB = createHash('sha256').update(b).digest();
    return timingSafeEqual(hashA, hashB);
  }
}

const TOKEN_EXPIRY = '12h';

interface AdminTokenPayload {
  sub: 'admin';
}