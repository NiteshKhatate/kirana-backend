import { ConfigService } from '@nestjs/config';
import { validateMailEnvironment } from '../../config/mail-environment';
import { EmailService } from './email.service';

describe('Verification email content', () => {
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
