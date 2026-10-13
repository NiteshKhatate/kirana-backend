import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { abortOnError: false });

  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '0.0.0.0',
  );
}

void bootstrap().catch(() => {
  // Do not print startup exceptions: driver errors may include credentials.
  console.error(
    'Backend startup failed; check configuration and database availability.',
  );
  process.exitCode = 1;
});
