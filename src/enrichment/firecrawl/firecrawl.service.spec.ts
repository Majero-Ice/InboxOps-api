import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FirecrawlScrapeError, FirecrawlService } from './firecrawl.service';

const mockFetch = jest.fn();

describe('FirecrawlService', () => {
  let service: FirecrawlService;

  beforeEach(async () => {
    mockFetch.mockReset();
    global.fetch = mockFetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirecrawlService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'FIRECRAWL_API_KEY') {
                return 'fc-test-key';
              }
              throw new Error(`Missing config: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = module.get(FirecrawlService);
  });

  it('returns markdown from a successful scrape', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { markdown: '# Acme Corp\nEnterprise software.' },
      }),
    });

    const result = await service.scrape('https://acme.com');

    expect(result).toBe('# Acme Corp\nEnterprise software.');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v1/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc-test-key',
        }),
      }),
    );
  });

  it('returns null for 404 responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: 'Not found' }),
    });

    const result = await service.scrape('https://acme.com/about');

    expect(result).toBeNull();
  });

  it('retries transient server errors', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'Server error' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { markdown: 'Recovered content' },
        }),
      });

    const result = await service.scrape('https://acme.com');

    expect(result).toBe('Recovered content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after retries are exhausted', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Server error' }),
    });

    await expect(service.scrape('https://acme.com')).rejects.toBeInstanceOf(
      FirecrawlScrapeError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
