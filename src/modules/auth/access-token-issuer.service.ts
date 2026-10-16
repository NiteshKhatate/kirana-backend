import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { JwtConfig } from '../../config/jwt-environment';
import { SessionConfig } from '../../config/session-environment';
import { AuthClock } from './auth-clock.service';

@Injectable()
export class AccessTokenIssuer {
  constructor(
    private readonly config: ConfigService,
    private readonly clock: AuthClock,
  ) {}
  issue(userId: string) {
    const jwt = this.config.getOrThrow<JwtConfig>('JWT');
    const session = this.config.getOrThrow<SessionConfig>('SESSION');
    if (!session.privateKey) throw new ServiceUnavailableException();
    const now = Math.floor(this.clock.now().getTime() / 1000);
    return sign(
      {
        sub: userId,
        jti: randomUUID(),
        iat: now,
        exp: now + jwt.maxLifetimeSeconds,
        token_use: 'access',
      },
      session.privateKey,
      {
        algorithm: 'RS256',
        issuer: jwt.issuer,
        audience: jwt.audience,
        keyid: jwt.keyId,
      },
    );
  }
}
