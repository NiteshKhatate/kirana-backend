import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { requestContext } from './common/http/request-context';
import { SafeExceptionFilter } from './common/http/safe-exception.filter';

/** Shared by the real bootstrap and HTTP tests to keep the contract identical. */
export function configureApp(app: INestApplication): void {
  app.use(requestContext());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new SafeExceptionFilter());
  const config = new DocumentBuilder()
    .setTitle('Kirana API')
    .setDescription('Kirana SaaS backend API')
    .setVersion('1.0')
    .addGlobalParameters({
      name: 'x-request-id',
      in: 'header',
      required: false,
      schema: { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
    })
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config),
  );
}
