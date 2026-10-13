import { Injectable, Logger } from '@nestjs/common';

export type SecurityEvent =
  | 'account.registered'
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
