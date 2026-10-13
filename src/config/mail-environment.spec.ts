import { validateMailEnvironment } from './mail-environment';

const production = {
  EMAIL_FROM: 'no-reply@example.com',
  VERIFY_EMAIL_URL: 'https://app.example.com/verify-email',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'placeholder',
  SMTP_PASSWORD: 'private-placeholder',
};

describe('Mail configuration', () => {
  it('isolates test email and defaults development to a private outbox', () => {
    expect(validateMailEnvironment({}, 'development').transport).toBe(
      'development',
    );
    expect(
      validateMailEnvironment({ MAIL_TRANSPORT: 'smtp' }, 'test').transport,
    ).toBe('test');
  });
  it('requires production SMTP and a secure frontend link', () => {
    expect(() => validateMailEnvironment({}, 'production')).toThrow(
      'EMAIL_FROM',
    );
    expect(validateMailEnvironment(production, 'production')).toMatchObject({
      transport: 'smtp',
      smtp: { port: 587, secure: false },
    });
    expect(() =>
      validateMailEnvironment(
        { ...production, MAIL_TRANSPORT: 'development' },
        'production',
      ),
    ).toThrow('MAIL_TRANSPORT');
  });
  it.each([
    'http://app.example.com/verify-email',
    'https://app.example.com/verify-email?token=placeholder',
    'https://app.example.com/#fragment',
    'https://user:password@app.example.com/verify-email',
  ])('rejects unsafe production links %s', (VERIFY_EMAIL_URL) => {
    expect(() =>
      validateMailEnvironment(
        { ...production, VERIFY_EMAIL_URL },
        'production',
      ),
    ).toThrow('VERIFY_EMAIL_URL');
  });
  it.each([
    { SMTP_PASSWORD: '' },
    { SMTP_HOST: 'smtp://invalid' },
    { SMTP_PORT: 'invalid' },
    { SMTP_SECURE: 'yes' },
    { EMAIL_FROM: 'invalid' },
    { EMAIL_VERIFICATION_TTL_SECONDS: 0 },
    { VERIFICATION_RESEND_COOLDOWN_SECONDS: 0 },
  ])('rejects invalid settings without leaking values: %p', (override) => {
    try {
      validateMailEnvironment({ ...production, ...override }, 'production');
      throw new Error('Validation unexpectedly passed');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^Invalid configuration:/);
      expect((error as Error).message).not.toContain('private-placeholder');
    }
  });
});
