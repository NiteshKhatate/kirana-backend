import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { MailAdapter, MailDelivery, VerificationMail } from './mail.adapter';

export class DevelopmentMailAdapter extends MailAdapter {
  constructor(
    private readonly environment: string,
    private readonly directory = resolve(process.cwd(), '.local-mail'),
  ) {
    super();
  }

  async send(message: VerificationMail): Promise<MailDelivery> {
    if (this.environment !== 'development')
      throw new Error('Development mail is disabled');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.directory, `${randomUUID()}.json`),
      JSON.stringify(message, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    return 'development-outbox';
  }
}
