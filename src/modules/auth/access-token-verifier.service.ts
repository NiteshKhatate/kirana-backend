import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decode, verify } from 'jsonwebtoken';
import { isUUID } from 'class-validator';
import { JwtConfig } from '../../config/jwt-environment';
import { AuthClock } from './auth-clock.service';

@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly config: ConfigService,
    private readonly clock: AuthClock,
  ) {}

  subject(token: string): string {
    const config = this.config.getOrThrow<JwtConfig>('JWT');
    const now = Math.floor(this.clock.now().getTime() / 1000);
    try {
      if (!config.publicKey || token.length > 8192) throw new Error();
      const header = decode(token, { complete: true })?.header;
      const key =
        header?.kid === undefined
          ? config.publicKey
          : config.verificationKeys?.get(header.kid);
      if (!key) throw new Error();
      const result = verify(token, key, {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
        clockTimestamp: now,
        clockTolerance: 0,
        maxAge: config.maxLifetimeSeconds,
        complete: true,
      });
      const claims = result.payload;
      if (
        result.header.typ !== 'JWT' ||
        typeof claims === 'string' ||
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        typeof claims.jti !== 'string' ||
        !isUUID(claims.jti) ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp) ||
        claims.iat === undefined ||
        claims.exp === undefined ||
        claims.iat > now ||
        claims.exp <= now ||
        claims.exp <= claims.iat ||
        claims.exp - claims.iat > config.maxLifetimeSeconds ||
        claims.token_use !== 'access'
      )
        throw new Error();
      return claims.sub;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
