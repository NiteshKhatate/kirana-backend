import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { MailConfig } from '../../config/mail-environment';
import { MailAdapter, MailDelivery, VerificationMail } from './mail.adapter';

export class SmtpMailAdapter extends MailAdapter {
  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly config: MailConfig) {
    super();
    if (!config.smtp) throw new Error('SMTP is not configured');
    this.transport = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      requireTLS: !config.smtp.secure,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(message: VerificationMail): Promise<MailDelivery> {
    try {
      const info = await this.transport.sendMail({
        from: this.config.from,
        ...message,
      });
      const accepted = info.accepted.some(
        (recipient) => recipient.toLowerCase() === message.to.toLowerCase(),
      );
      if (!accepted) throw new Error('Recipient not accepted');
      return 'smtp-accepted';
    } catch {
      throw new Error('Verification email delivery failed');
    }
  }
}
