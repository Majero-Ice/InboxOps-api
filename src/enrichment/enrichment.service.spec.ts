import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClaudeService } from '../claude/claude.service';
import { EnrichmentService } from './enrichment.service';
import { FirecrawlService } from './firecrawl/firecrawl.service';

const companyProfile = {
  confidence: 0.9,
  model_used: 'claude-haiku-test',
  company: {
    name: 'Acme Corp',
    description: 'Enterprise software solutions',
    industry: 'Technology',
    size_hint: '50-200 employees',
    products_services: ['SaaS platform', 'Consulting'],
    location: 'San Francisco, CA',
    tone: 'Professional',
  },
};

describe('EnrichmentService', () => {
  let service: EnrichmentService;
  let firecrawlService: jest.Mocked<Pick<FirecrawlService, 'scrape'>>;
  let claudeService: jest.Mocked<Pick<ClaudeService, 'extractCompanyProfile'>>;

  beforeEach(async () => {
    firecrawlService = { scrape: jest.fn() };
    claudeService = { extractCompanyProfile: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: FirecrawlService, useValue: firecrawlService },
        { provide: ClaudeService, useValue: claudeService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                ENRICH_MAX_CHARS: 12000,
                ENRICH_ABOUT_PATHS: '/about,/about-us',
                PUBLIC_EMAIL_DOMAINS:
                  'gmail.com,outlook.com,hotmail.com,yahoo.com',
              };
              return key in config ? config[key] : defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = module.get(EnrichmentService);
  });

  it('skips public email domains without calling Firecrawl or Claude', async () => {
    const result = await service.enrich({ domain: 'gmail.com' });

    expect(result.status).toBe('skipped');
    expect(result.company).toBeNull();
    expect(firecrawlService.scrape).not.toHaveBeenCalled();
    expect(claudeService.extractCompanyProfile).not.toHaveBeenCalled();
  });

  it('returns ok with a populated company profile', async () => {
    firecrawlService.scrape.mockImplementation(async (url: string) => {
      if (url === 'https://acme.com') {
        return (
          'Acme Corp builds enterprise software for global teams. ' +
          'We deliver SaaS platforms, consulting, and long-term support for customers worldwide.'
        );
      }
      return null;
    });
    claudeService.extractCompanyProfile.mockResolvedValue(companyProfile);

    const result = await service.enrich({ domain: 'acme.com' });

    expect(result.status).toBe('ok');
    expect(result.domain).toBe('acme.com');
    expect(result.source_url).toBe('https://acme.com');
    expect(result.company).toEqual(companyProfile.company);
    expect(result.confidence).toBe(0.9);
    expect(claudeService.extractCompanyProfile).toHaveBeenCalledWith(
      expect.stringContaining('Acme Corp builds enterprise software'),
      'acme.com',
    );
  });

  it('returns skipped when scraped content is not meaningful', async () => {
    firecrawlService.scrape.mockResolvedValue('short');

    const result = await service.enrich({ domain: 'acme.com' });

    expect(result.status).toBe('skipped');
    expect(claudeService.extractCompanyProfile).not.toHaveBeenCalled();
  });

  it('returns enrichment_failed when Firecrawl fails', async () => {
    firecrawlService.scrape.mockRejectedValue(new Error('site unreachable'));

    const result = await service.enrich({ domain: 'acme.com' });

    expect(result.status).toBe('enrichment_failed');
    expect(result.company).toBeNull();
    expect(claudeService.extractCompanyProfile).not.toHaveBeenCalled();
  });

  it('normalizes domains with protocol and casing', async () => {
    firecrawlService.scrape.mockResolvedValue(
      'A'.repeat(120) + ' meaningful company content about products and services.',
    );
    claudeService.extractCompanyProfile.mockResolvedValue(companyProfile);

    const result = await service.enrich({ domain: 'HTTPS://Acme.COM/path' });

    expect(result.domain).toBe('acme.com');
    expect(firecrawlService.scrape).toHaveBeenCalledWith('https://acme.com');
  });
});
