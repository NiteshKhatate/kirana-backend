export interface VerificationMail {
  to: string;
  subject: string;
  text: string;
}
export type MailDelivery =
  'development-outbox' | 'smtp-accepted' | 'resend-accepted';

export abstract class MailAdapter {
  abstract send(message: VerificationMail): Promise<MailDelivery>;
}
