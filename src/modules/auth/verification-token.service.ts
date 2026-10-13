import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class VerificationTokenService {
  create(): string {
    return randomBytes(32).toString('hex');
  }
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
