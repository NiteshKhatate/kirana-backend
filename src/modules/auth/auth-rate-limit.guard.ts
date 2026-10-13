import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { AuthClock } from './auth-clock.service';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { expiresAt: number; count: number }
  >();

  constructor(private readonly clock: AuthClock) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const operation = context.getHandler().name;
    const limit =
      operation === 'register'
        ? 5
        : operation === 'resendVerification'
          ? 10
          : 30;
    this.consume(
      `${operation}:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
      limit,
    );
    return true;
  }

  consume(identity: string, limit: number): void {
    const now = this.clock.now().getTime();
    const key = createHash('sha256').update(identity).digest('hex');
    let entry = this.windows.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (this.windows.size >= 10000) {
        for (const [candidate, value] of this.windows)
          if (value.expiresAt <= now) this.windows.delete(candidate);
        if (!this.windows.has(key) && this.windows.size >= 10000)
          throw new HttpException('Too Many Requests', 429);
      }
      entry = { expiresAt: now + 60000, count: 0 };
      this.windows.set(key, entry);
    }
    if (entry.count >= limit) throw new HttpException('Too Many Requests', 429);
    entry.count++;
  }
}
