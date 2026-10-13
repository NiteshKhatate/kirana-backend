import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailConfig } from '../../config/mail-environment';
import { MailAdapter } from './mail.adapter';
import { DevelopmentMailAdapter } from './development-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import { EmailService } from './email.service';

class TestMailAdapter extends MailAdapter {
  send(): Promise<never> {
    return Promise.reject(new Error('Tests must override the mail adapter'));
  }
}

@Module({
  providers: [
    EmailService,
    {
      provide: MailAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailAdapter => {
        const mail = config.getOrThrow<MailConfig>('MAIL');
        if (mail.transport === 'test') return new TestMailAdapter();
        if (mail.transport === 'smtp') return new SmtpMailAdapter(mail);
        return new DevelopmentMailAdapter(
          config.getOrThrow<string>('NODE_ENV'),
        );
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
