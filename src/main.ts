import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

function resolveCorsOrigin(
  raw: string,
): boolean | string | RegExp | (string | RegExp)[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') {
    return true;
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  const corsOrigins = configService.get<string>('CORS_ORIGINS', '');
  app.enableCors({
    origin: resolveCorsOrigin(corsOrigins),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-api-key'],
  });

  const maxUploadMb = configService.get<number>('MAX_UPLOAD_MB', 15);
  const bodyLimitMb = Math.ceil(maxUploadMb * 1.4) + 1;
  app.use(json({ limit: `${bodyLimitMb}mb` }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
