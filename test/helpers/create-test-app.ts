import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { json } from 'express';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { ClaudeService } from '../../src/claude/claude.service';

export async function createTestApp(
  claudeService: Partial<ClaudeService>,
): Promise<INestApplication<App>> {
  process.env.SERVICE_API_KEY = 'test-api-key';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.CLAUDE_TEXT_MODEL = 'claude-haiku-4-5-20251001';
  process.env.CLAUDE_VISION_MODEL = 'claude-sonnet-4-6';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ClaudeService)
    .useValue(claudeService)
    .compile();

  const app = moduleFixture.createNestApplication({ bodyParser: false });
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
  await app.init();
  return app;
}
