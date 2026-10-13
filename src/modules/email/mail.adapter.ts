export interface VerificationMail {
  to: string;
  subject: string;
  text: string;
}
export type MailDelivery = 'development-outbox' | 'smtp-accepted';

export abstract class MailAdapter {
  abstract send(message: VerificationMail): Promise<MailDelivery>;
}
