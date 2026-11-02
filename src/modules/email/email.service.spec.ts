import { ConfigService } from '@nestjs/config';
import { validateMailEnvironment } from '../../config/mail-environment';
import { EmailService } from './email.service';

describe('Verification email content', () => {
  it('emails one-time codes without URLs in explicit backend-preview mode', async () => {
    const adapter = { send: jest.fn().mockResolvedValue('resend-accepted') };
    const service = new EmailService(
      new ConfigService({
        MAIL: validateMailEnvironment({ AUTH_EMAIL_MODE: 'code' }, 'test'),
        SESSION: { resetTtlSeconds: 1800, resetUrl: '' },
      }),
      adapter,
    );
    const token = 'a'.repeat(64);
    await service.sendVerification('owner@example.com', token);
    await service.sendPasswordReset('owner@example.com', token);
    for (const [message] of adapter.send.mock.calls as [{ text: string }][]) {
      expect(message.text).toContain(token);
      expect(message.text).not.toMatch(/https?:|\?token=/);
    }
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
  it('addresses the recipient and includes the configured one-time link without logging', async () => {
    const adapter = { send: jest.fn().mockResolvedValue('development-outbox') };
    const service = new EmailService(
      new ConfigService({ MAIL: validateMailEnvironment({}, 'test') }),
      adapter,
    );
    await service.sendVerification('owner@example.com', 'a'.repeat(64));
    expect(adapter.send).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: 'Verify your Kirana email',
      text: expect.stringContaining(
        `http://localhost:3000/verify-email?token=${'a'.repeat(64)}`,
      ) as unknown,
    });
  });
});
