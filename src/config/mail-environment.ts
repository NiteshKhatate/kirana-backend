import { isEmail } from 'class-validator';

export interface MailConfig {
  transport: 'development' | 'smtp' | 'test';
  from: string;
  verifyEmailUrl: string;
  verificationTtlSeconds: number;
  resendCooldownSeconds: number;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
  };
}

export function validateMailEnvironment(
  input: Record<string, unknown>,
  mode: string,
): MailConfig {
  const invalid = new Set<string>();
  const transport =
    mode === 'test'
      ? 'test'
      : (input.MAIL_TRANSPORT ??
        (mode === 'production' ? 'smtp' : 'development'));
  if (
    typeof transport !== 'string' ||
    !['development', 'smtp', 'test'].includes(transport) ||
    (mode === 'production' && transport !== 'smtp') ||
    (mode === 'development' && transport === 'test')
  )
    invalid.add('MAIL_TRANSPORT');
  const from =
    input.EMAIL_FROM ??
    (mode === 'production' ? '' : 'no-reply@kirana.invalid');
  if (typeof from !== 'string' || !isEmail(from)) invalid.add('EMAIL_FROM');
  const verifyEmailUrl =
    input.VERIFY_EMAIL_URL ??
    (mode === 'production' ? '' : 'http://localhost:3000/verify-email');
  try {
    if (typeof verifyEmailUrl !== 'string') throw new Error();
    const url = new URL(verifyEmailUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (mode === 'production' &&
        (url.protocol !== 'https:' ||
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    )
      throw new Error();
  } catch {
    invalid.add('VERIFY_EMAIL_URL');
  }
  function seconds(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = input[key] ?? fallback;
    const parsed =
      typeof value === 'string' || typeof value === 'number'
        ? Number(value)
        : NaN;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      invalid.add(key);
    return parsed;
  }
  const verificationTtlSeconds = seconds(
    'EMAIL_VERIFICATION_TTL_SECONDS',
    86400,
    300,
    86400,
  );
  const resendCooldownSeconds = seconds(
    'VERIFICATION_RESEND_COOLDOWN_SECONDS',
    60,
    60,
    3600,
  );
  let smtp: MailConfig['smtp'];
  if (transport === 'smtp') {
    const host = input.SMTP_HOST;
    const user = input.SMTP_USER;
    const password = input.SMTP_PASSWORD;
    const port = seconds('SMTP_PORT', 587, 1, 65535);
    const secure = input.SMTP_SECURE ?? 'false';
    if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(host))
      invalid.add('SMTP_HOST');
    if (typeof user !== 'string' || !user.trim()) invalid.add('SMTP_USER');
    if (typeof password !== 'string' || !password) invalid.add('SMTP_PASSWORD');
    if (typeof secure !== 'string' || !['true', 'false'].includes(secure))
      invalid.add('SMTP_SECURE');
    smtp = {
      host: host as string,
      port,
      secure: secure === 'true',
      user: user as string,
      password: password as string,
    };
  }
  if (invalid.size)
    throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return {
    transport: transport as MailConfig['transport'],
    from: from as string,
    verifyEmailUrl: verifyEmailUrl as string,
    verificationTtlSeconds,
    resendCooldownSeconds,
    smtp,
  };
}
