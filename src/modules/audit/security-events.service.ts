import { Injectable, Logger } from '@nestjs/common';

export type SecurityEvent =
  | 'account.registered'
  | 'invitation.delivery_failed'
  | 'session.login'
  | 'session.logout'
  | 'session.refresh_rejected'
  | 'password_reset.completed'
  | 'password_reset.delivery_failed'
  | 'email.verified'
  | 'verification.resend'
  | 'verification.delivery_failed';

@Injectable()
export class SecurityEvents {
  private readonly logger = new Logger('Security');
  record(event: SecurityEvent, userId: string): void {
    // Global identity events cannot use the existing tenant-scoped AuditLog.
    this.logger.log(JSON.stringify({ event, userId }));
  }
}
