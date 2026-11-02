import { MailConfig } from '../../config/mail-environment';
import { MailAdapter, MailDelivery, VerificationMail } from './mail.adapter';

/** HTTPS delivery works on hosts that restrict outbound SMTP. */
export class ResendMailAdapter extends MailAdapter {
  constructor(
    private readonly config: MailConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    super();
    if (!config.resendApiKey) throw new Error('Resend is not configured');
  }

  async send(message: VerificationMail): Promise<MailDelivery> {
    try {
      const response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        typeof result.id !== 'string' ||
        !result.id.trim()
      )
        throw new Error();
      // Provider acceptance does not establish delivery to the recipient's inbox.
      return 'resend-accepted';
    } catch {
      // Never propagate provider responses, recipients, one-time links or keys.
      throw new Error('Verification email delivery failed');
    }
  }
}
