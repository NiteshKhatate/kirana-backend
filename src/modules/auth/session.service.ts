import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { JwtConfig } from '../../config/jwt-environment';
import { SessionConfig } from '../../config/session-environment';
import { EmailService } from '../email/email.service';
import { SecurityEvents } from '../audit/security-events.service';
import { AuthClock } from './auth-clock.service';
import { PasswordService } from './password.service';
import { VerificationTokenService } from './verification-token.service';
import { AccessTokenIssuer } from './access-token-issuer.service';
import { LoginDto, ResetPasswordDto } from './dto/session.dto';

const RECOVERY_RESPONSE = {
  message:
    'If the account is eligible, a password reset email will be attempted.',
};

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly deliveries = new Set<Promise<unknown>>();
  private dummyHash?: Promise<string>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: VerificationTokenService,
    private readonly clock: AuthClock,
    private readonly config: ConfigService,
    private readonly issuer: AccessTokenIssuer,
    private readonly email: EmailService,
    private readonly events: SecurityEvents,
  ) {}

  async login(input: LoginDto) {
    const found = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!found) {
      this.dummyHash ??= this.passwords.hash(this.tokens.create());
      await this.passwords.verify(await this.dummyHash, input.password);
      throw new UnauthorizedException();
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.lockUser(tx, found.id);
        const user = await tx.user.findUnique({ where: { id: found.id } });
        const valid =
          user &&
          (await this.passwords.verify(user.passwordHash, input.password));
        if (
          !valid ||
          user.status !== UserStatus.ACTIVE ||
          !user.emailVerifiedAt
        )
          throw new UnauthorizedException();
        return this.createSession(tx, user.id, randomUUID());
      },
      { timeout: 15000 },
    );
    this.events.record('session.login', found.id);
    return result;
  }

  async refresh(raw: string) {
    const tokenHash = this.tokens.hash(raw);
    const found = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
    });
    if (!found) throw new UnauthorizedException();
    const result = await this.prisma.$transaction(async (tx) => {
      // User-level ordering also serializes refresh with password resets/logout.
      await this.lockUser(tx, found.userId);
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash },
      });
      if (!session) return null;
      const now = this.clock.now();
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (
        session.revokedAt ||
        session.expiresAt <= now ||
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !user.emailVerifiedAt
      ) {
        await tx.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return null;
      }
      const consumed = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return null;
      // Family expiry is absolute, rather than extended indefinitely on use.
      return this.createSession(
        tx,
        user.id,
        session.familyId,
        session.expiresAt,
      );
    });
    if (!result) {
      // Throw after committing revocation; throwing inside would undo containment.
      this.events.record('session.refresh_rejected', found.userId);
      throw new UnauthorizedException();
    }
    return result;
  }

  async logout(raw: string): Promise<void> {
    const found = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: this.tokens.hash(raw) },
    });
    if (!found) return;
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, found.userId);
      await tx.refreshSession.updateMany({
        where: { familyId: found.familyId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
    });
    this.events.record('session.logout', found.userId);
  }

  async forgotPassword(inputEmail: string) {
    const email = inputEmail.trim().toLowerCase();
    const issued = await this.prisma.$transaction(async (tx) => {
      const found = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!found) return null;
      await this.lockUser(tx, found.id);
      const user = await tx.user.findUnique({ where: { id: found.id } });
      if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerifiedAt)
        return null;
      const now = this.clock.now();
      const recent = await tx.passwordResetToken.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(now.getTime() - 60000) },
        },
      });
      if (recent) return null;
      const raw = this.tokens.create();
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hash(raw),
          createdAt: now,
          expiresAt: new Date(
            now.getTime() + this.settings().resetTtlSeconds * 1000,
          ),
        },
      });
      return { userId: user.id, raw };
    });
    if (issued) {
      if (this.deliveries.size < 128) {
        const pending = this.email
          .sendPasswordReset(email, issued.raw)
          .catch(() =>
            this.events.record('password_reset.delivery_failed', issued.userId),
          );
        this.deliveries.add(pending);
        void pending.then(() => this.deliveries.delete(pending));
      } else
        this.events.record('password_reset.delivery_failed', issued.userId);
    }
    return { ...RECOVERY_RESPONSE };
  }

  async resetPassword(input: ResetPasswordDto) {
    const tokenHash = this.tokens.hash(input.token);
    const found = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!found) throw new BadRequestException();
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, found.userId);
      const user = await tx.user.findUnique({ where: { id: found.userId } });
      const now = this.clock.now();
      if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerifiedAt)
        throw new BadRequestException();
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException();
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    this.events.record('password_reset.completed', found.userId);
    return { message: 'Password reset. Please log in again.' };
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    expiresAt = new Date(
      this.clock.now().getTime() + this.settings().refreshTtlSeconds * 1000,
    ),
  ) {
    const accessToken = this.issuer.issue(userId);
    const refreshToken = this.tokens.create();
    await tx.refreshSession.create({
      data: {
        userId,
        familyId,
        tokenHash: this.tokens.hash(refreshToken),
        expiresAt,
        createdAt: this.clock.now(),
      },
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<JwtConfig>('JWT').maxLifetimeSeconds,
    };
  }
  private settings() {
    return this.config.getOrThrow<SessionConfig>('SESSION');
  }
  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
  async onModuleDestroy() {
    await Promise.allSettled(this.deliveries);
  }
}
