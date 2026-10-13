import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '../users/users.service';
import { PublicUserDto } from '../users/public-user';
import { AccessTokenVerifier } from './access-token-verifier.service';

export interface AuthenticatedRequest extends Request {
  user?: PublicUserDto;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenVerifier,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string'
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
            authorization,
          )
        : null;
    if (!match) throw new UnauthorizedException();
    const id = this.tokens.subject(match[1]);
    const user = await this.users.findVerifiedActiveUser(id);
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }
}
