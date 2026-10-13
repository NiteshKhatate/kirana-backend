import { createTransport } from 'nodemailer';
import { validateMailEnvironment } from '../../config/mail-environment';
import { SmtpMailAdapter } from './smtp-mail.adapter';

const mockSend = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSend })),
}));

describe('SMTP adapter (SMTP mocked)', () => {
  const config = validateMailEnvironment(
    {
      EMAIL_FROM: 'no-reply@example.com',
      VERIFY_EMAIL_URL: 'https://app.example.com/verify-email',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'placeholder',
      SMTP_PASSWORD: 'placeholder',
    },
    'production',
  );
  const message = {
    to: 'owner@example.com',
    subject: 'Verify',
    text: 'test-link',
  };
  beforeEach(() => jest.clearAllMocks());

  it('requires TLS, disables SMTP logging and confirms recipient acceptance', async () => {
    mockSend.mockResolvedValueOnce({ accepted: [message.to] });
    const adapter = new SmtpMailAdapter(config);
    await expect(adapter.send(message)).resolves.toBe('smtp-accepted');
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        logger: false,
        debug: false,
      }),
    );
    expect(mockSend).toHaveBeenCalledWith({ from: config.from, ...message });
  });
  it.each(['rejected', 'smtp-error'])(
    'does not claim delivery on %s',
    async (failure) => {
      if (failure === 'rejected')
        mockSend.mockResolvedValueOnce({ accepted: [] });
      else mockSend.mockRejectedValueOnce(new Error('private-smtp-credential'));
      const adapter = new SmtpMailAdapter(config);
      await expect(adapter.send(message)).rejects.toThrow(
        'Verification email delivery failed',
      );
    },
  );
});
