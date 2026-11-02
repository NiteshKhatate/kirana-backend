import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateMailEnvironment } from '../../config/mail-environment';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import { MailAdapter } from './mail.adapter';
import { ResendMailAdapter } from './resend-mail.adapter';

describe('Resend HTTPS adapter (network mocked)', () => {
  const config = validateMailEnvironment(
    {
      MAIL_TRANSPORT: 'resend',
      EMAIL_FROM: 'onboarding@resend.dev',
      VERIFY_EMAIL_URL: 'https://app.example.com/verify-email',
      RESEND_API_KEY: 're_test_placeholder',
    },
    'production',
  );
  const message = {
    to: 'owner@example.com',
    subject: 'Verify',
    text: 'private-one-time-link',
  };
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  beforeEach(() => fetcher.mockReset());

  it('sends only to the fixed HTTPS API and confirms provider acceptance', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ id: 'test-message-id' }));
    const adapter = new ResendMailAdapter(config, fetcher);
    await expect(adapter.send(message)).resolves.toBe('resend-accepted');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test_placeholder',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: expect.any(AbortSignal) as AbortSignal,
      redirect: 'error',
    });
  });

  it.each([403, 429, 500])(
    'reports HTTP %s as failure without exposing provider response bodies',
    async (status) => {
      fetcher.mockResolvedValueOnce(
        new Response('private-key-and-recipient', { status }),
      );
      await expect(
        new ResendMailAdapter(config, fetcher).send(message),
      ).rejects.toThrow('Verification email delivery failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, {}, { id: '' }, { id: 123 }])(
    'does not claim acceptance for an invalid success body: %p',
    async (body) => {
      fetcher.mockResolvedValueOnce(Response.json(body));
      await expect(
        new ResendMailAdapter(config, fetcher).send(message),
      ).rejects.toThrow('Verification email delivery failed');
    },
  );

  it('bounds request time and suppresses timeout/network/redirect details', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    try {
      fetcher.mockRejectedValueOnce(new Error('private-request-details'));
      await expect(
        new ResendMailAdapter(config, fetcher).send(message),
      ).rejects.toThrow('Verification email delivery failed');
      expect(timeout).toHaveBeenCalledWith(10000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('requires validated credentials', () => {
    expect(
      () => new ResendMailAdapter({ ...config, resendApiKey: undefined }),
    ).toThrow('Resend is not configured');
  });

  it('selects HTTPS delivery through dependency injection for all email flows', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ MAIL: config })],
        }),
        EmailModule,
      ],
    }).compile();
    try {
      expect(module.get(MailAdapter)).toBeInstanceOf(ResendMailAdapter);
      expect(module.get(EmailService)).toBeInstanceOf(EmailService);
    } finally {
      await module.close();
    }
  });
});
