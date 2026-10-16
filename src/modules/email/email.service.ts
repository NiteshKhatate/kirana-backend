import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailConfig } from '../../config/mail-environment';
import { MailAdapter, MailDelivery } from './mail.adapter';
import { SessionConfig } from '../../config/session-environment';

@Injectable()
export class EmailService {
  constructor(
    private readonly config: ConfigService,
    private readonly adapter: MailAdapter,
  ) {}

  sendInvitation(
    email: string,
    token: string,
    expiresAt: Date,
  ): Promise<MailDelivery> {
    // One-time invitation codes stay in the mail body, never URL credentials.
    return this.adapter.send({
      to: email,
      subject: 'Your Kirana staff invitation',
      text: `You have been invited to join an organization in Kirana. Sign in with this email, verify it, and enter this one-time invitation code:\n${token}\n\nExpires at ${expiresAt.toISOString()}. If you did not expect this invitation, ignore this email.`,
    });
  }

  sendPasswordReset(email: string, token: string): Promise<MailDelivery> {
    const session = this.config.getOrThrow<SessionConfig>('SESSION');
    const url = new URL(session.resetUrl);
    url.searchParams.set('token', token);
    return this.adapter.send({
      to: email,
      subject: 'Reset your Kirana password',
      text: `Reset your password using this one-time link:\n${url.toString()}\n\nThis link expires in ${session.resetTtlSeconds / 60} minutes. If you did not request this, ignore this email.`,
    });
  }

  sendVerification(email: string, token: string): Promise<MailDelivery> {
    const mail = this.config.getOrThrow<MailConfig>('MAIL');
    const url = new URL(mail.verifyEmailUrl);
    url.searchParams.set('token', token);
    return this.adapter.send({
      to: email,
      subject: 'Verify your Kirana email',
      text: `Verify your email using this one-time link:\n${url.toString()}\n\nThis link expires in ${mail.verificationTtlSeconds / 3600} hours. If you did not create this account, ignore this email.`,
    });
  }
}
