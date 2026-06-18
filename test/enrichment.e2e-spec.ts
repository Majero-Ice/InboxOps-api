import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-test-app';

const companyProfile = {
  confidence: 0.88,
  model_used: 'claude-haiku-test',
  company: {
    name: 'Acme Corp',
    description: 'Enterprise software solutions',
    industry: 'Technology',
    size_hint: '50-200 employees',
    products_services: ['SaaS platform'],
    location: 'San Francisco, CA',
    tone: 'Professional',
  },
};

describe('Enrichment (e2e)', () => {
  let app: INestApplication<App>;
  let firecrawlScrape: jest.Mock;
  let extractCompanyProfile: jest.Mock;

  afterEach(async () => {
    await app?.close();
  });

  describe('POST /enrich auth', () => {
    beforeEach(async () => {
      firecrawlScrape = jest.fn();
      extractCompanyProfile = jest.fn();

      app = await createTestApp({
        claudeService: { extractCompanyProfile },
        firecrawlService: { scrape: firecrawlScrape },
      });
    });

    it('returns 401 without an API key', () => {
      return request(app.getHttpServer())
        .post('/enrich')
        .send({ domain: 'acme.com' })
        .expect(401);
    });

    it('returns 401 with an invalid API key', () => {
      return request(app.getHttpServer())
        .post('/enrich')
        .set('x-api-key', 'wrong-key')
        .send({ domain: 'acme.com' })
        .expect(401);
    });
  });

  describe('POST /enrich outcomes', () => {
    it('returns ok for a corporate domain', async () => {
      firecrawlScrape = jest.fn().mockResolvedValue(
        'Acme Corp builds enterprise software for global teams with a professional tone.',
      );
      extractCompanyProfile = jest.fn().mockResolvedValue(companyProfile);

      app = await createTestApp({
        claudeService: { extractCompanyProfile },
        firecrawlService: { scrape: firecrawlScrape },
      });

      const response = await request(app.getHttpServer())
        .post('/enrich')
        .set('x-api-key', 'test-api-key')
        .send({ domain: 'acme.com' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.company.name).toBe('Acme Corp');
      expect(response.body.source_url).toBe('https://acme.com');
      expect(response.body.meta.model_used).toBe('claude-haiku-test');
    });

    it('returns skipped for a public email domain', async () => {
      firecrawlScrape = jest.fn();
      extractCompanyProfile = jest.fn();

      app = await createTestApp({
        claudeService: { extractCompanyProfile },
        firecrawlService: { scrape: firecrawlScrape },
      });

      const response = await request(app.getHttpServer())
        .post('/enrich')
        .set('x-api-key', 'test-api-key')
        .send({ domain: 'gmail.com' })
        .expect(200);

      expect(response.body.status).toBe('skipped');
      expect(response.body.company).toBeNull();
      expect(firecrawlScrape).not.toHaveBeenCalled();
      expect(extractCompanyProfile).not.toHaveBeenCalled();
    });

    it('returns enrichment_failed when Firecrawl fails', async () => {
      firecrawlScrape = jest
        .fn()
        .mockRejectedValue(new Error('site unreachable'));
      extractCompanyProfile = jest.fn();

      app = await createTestApp({
        claudeService: { extractCompanyProfile },
        firecrawlService: { scrape: firecrawlScrape },
      });

      const response = await request(app.getHttpServer())
        .post('/enrich')
        .set('x-api-key', 'test-api-key')
        .send({ domain: 'acme.com' })
        .expect(200);

      expect(response.body.status).toBe('enrichment_failed');
      expect(response.body.company).toBeNull();
    });
  });
});
