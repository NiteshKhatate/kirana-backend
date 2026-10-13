import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { VerificationTokenService } from './verification-token.service';
import { AuthClock } from './auth-clock.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { UsersModule } from '../users/users.module';
import { AccessTokenVerifier } from './access-token-verifier.service';
import { AccessTokenGuard } from './access-token.guard';

@Module({
  imports: [AuditModule, EmailModule, UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    VerificationTokenService,
    AuthClock,
    AuthRateLimitGuard,
    AccessTokenVerifier,
    AccessTokenGuard,
  ],
  exports: [AccessTokenVerifier, AccessTokenGuard],
})
export class AuthModule {}
