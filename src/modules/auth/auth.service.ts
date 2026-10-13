import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MailConfig } from '../../config/mail-environment';
import { SecurityEvents } from '../audit/security-events.service';
import { EmailService } from '../email/email.service';
import { publicUserSelect } from '../users/public-user';
import { PasswordService } from './password.service';
import { VerificationTokenService } from './verification-token.service';
import { AuthClock } from './auth-clock.service';
import { RegisterDto } from './dto/register.dto';

const RESEND_MESSAGE = {
  message:
    'If the account is eligible, a verification email will be attempted.',
};

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly pendingDeliveries = new Set<Promise<unknown>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: VerificationTokenService,
    private readonly clock: AuthClock,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly events: SecurityEvents,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(input.password);
    const token = this.tokens.create();
    const now = this.clock.now();
    let user: Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        return tx.user.create({
          data: {
            fullName: input.fullName.trim(),
            email,
            passwordHash,
            emailTokens: {
              create: {
                tokenHash: this.tokens.hash(token),
                createdAt: now,
                expiresAt: this.expiry(now),
              },
            },
          },
          select: publicUserSelect,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException();
      throw error;
    }
    this.events.record('account.registered', user.id);
    const verificationEmailDelivery = await this.deliver(user.id, email, token);
    return { user, verificationEmailDelivery };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.tokens.hash(rawToken);
    const userId = await this.prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
      });
      if (!token) throw new BadRequestException();
      await this.lockUser(tx, token.userId);
      const now = this.clock.now();
      const user = await tx.user.findUnique({ where: { id: token.userId } });
      if (!user || user.status !== UserStatus.ACTIVE || user.emailVerifiedAt)
        throw new BadRequestException();
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException();
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      return user.id;
    });
    // No token value, email address or credential is included in security events.
    this.events.record('email.verified', userId);
    return { message: 'Email verified.' };
  }

  async resendVerification(inputEmail: string) {
    const email = inputEmail.trim().toLowerCase();
    const issued = await this.prisma.$transaction(async (tx) => {
      const found = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!found) return null;
      await this.lockUser(tx, found.id);
      const now = this.clock.now();
      const user = await tx.user.findUnique({ where: { id: found.id } });
      if (!user || user.status !== UserStatus.ACTIVE || user.emailVerifiedAt)
        return null;
      const cooldown =
        this.config.getOrThrow<MailConfig>('MAIL').resendCooldownSeconds;
      const recent = await tx.emailVerificationToken.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(now.getTime() - cooldown * 1000) },
        },
      });
      if (recent) return null;
      const raw = this.tokens.create();
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hash(raw),
          createdAt: now,
          expiresAt: this.expiry(now),
        },
      });
      return { userId: user.id, raw };
    });
    if (issued) {
      this.events.record('verification.resend', issued.userId);
      this.queueDelivery(issued.userId, email, issued.raw);
    }
    return { ...RESEND_MESSAGE };
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    // All verification/resend operations lock the same row before token changes.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  private expiry(now: Date): Date {
    return new Date(
      now.getTime() +
        this.config.getOrThrow<MailConfig>('MAIL').verificationTtlSeconds *
          1000,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pendingDeliveries);
  }

  private queueDelivery(userId: string, email: string, token: string): void {
    // Bounded, best-effort process queue; generic recovery responses do not wait
    // on SMTP latency. Pending work drains on graceful shutdown, but is not durable.
    if (this.pendingDeliveries.size >= 128) {
      this.events.record('verification.delivery_failed', userId);
      return;
    }
    const pending = this.deliver(userId, email, token);
    this.pendingDeliveries.add(pending);
    void pending.then(
      () => this.pendingDeliveries.delete(pending),
      () => this.pendingDeliveries.delete(pending),
    );
  }

  private async deliver(userId: string, email: string, token: string) {
    try {
      return await this.email.sendVerification(email, token);
    } catch {
      this.events.record('verification.delivery_failed', userId);
      return 'failed' as const;
    }
  }
}
