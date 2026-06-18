import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

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
  await app.listen(port);
}
bootstrap();
