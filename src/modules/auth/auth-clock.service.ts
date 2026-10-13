import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthClock {
  now(): Date {
    return new Date();
  }
}
