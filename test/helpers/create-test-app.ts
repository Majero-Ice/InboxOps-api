import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { json } from 'express';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { ClaudeService } from '../../src/claude/claude.service';
import { DbService } from '../../src/db/db.service';
import { FirecrawlService } from '../../src/enrichment/firecrawl/firecrawl.service';

export interface TestAppOverrides {
  claudeService?: Partial<ClaudeService>;
  firecrawlService?: Partial<FirecrawlService>;
  dbService?: Partial<DbService>;
}

const testConfig: Record<string, string | number> = {
  SERVICE_API_KEY: 'test-api-key',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  CLAUDE_TEXT_MODEL: 'claude-haiku-4-5-20251001',
  CLAUDE_VISION_MODEL: 'claude-sonnet-4-6',
  FIRECRAWL_API_KEY: 'fc-test-key',
  PDF_TEXT_MIN_CHARS: 100,
  PDF_MAX_VISION_PAGES: 5,
  CONFIDENCE_THRESHOLD: 0.7,
  MAX_UPLOAD_MB: 15,
  ENRICH_MAX_CHARS: 12000,
  ENRICH_ABOUT_PATHS: '/about,/about-us',
  PUBLIC_EMAIL_DOMAINS:
    'gmail.com,outlook.com,hotmail.com,yahoo.com,icloud.com,proton.me,protonmail.com,gmx.com,web.de,mail.ru,yandex.ru',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_NAME: 'postgres',
  DB_USER: 'postgres',
  DB_PASSWORD: 'postgres',
  ADMIN_PASSWORD: 'admin-test-password',
  ADMIN_JWT_SECRET: 'admin-test-jwt-secret',
};

const defaultDbService = {
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  onModuleInit: jest.fn(),
  onModuleDestroy: jest.fn(),
};

const configService = {
  get: <T>(key: string, defaultValue?: T): T | undefined => {
    if (key in testConfig) {
      return testConfig[key] as T;
    }
    return defaultValue;
  },
  getOrThrow: <T>(key: string): T => {
    if (key in testConfig) {
      return testConfig[key] as T;
    }
    throw new Error(`Config key not found: ${key}`);
  },
};

export async function createTestApp(
  overrides: TestAppOverrides = {},
): Promise<INestApplication<App>> {
  let moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue(configService)
    .overrideProvider(DbService)
    .useValue({ ...defaultDbService, ...overrides.dbService });

  if (overrides.claudeService) {
    moduleBuilder = moduleBuilder
      .overrideProvider(ClaudeService)
      .useValue(overrides.claudeService);
  }

  if (overrides.firecrawlService) {
    moduleBuilder = moduleBuilder
      .overrideProvider(FirecrawlService)
      .useValue(overrides.firecrawlService);
  }

  const moduleFixture: TestingModule = await moduleBuilder.compile();

  const app = moduleFixture.createNestApplication({ bodyParser: false });
  const maxUploadMb = configService.get<number>('MAX_UPLOAD_MB', 15)!;
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
