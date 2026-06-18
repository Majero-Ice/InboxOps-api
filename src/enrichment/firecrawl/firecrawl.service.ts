import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v1';
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

export class FirecrawlScrapeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FirecrawlScrapeError';
  }
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
  };
  error?: string;
}

@Injectable()
export class FirecrawlService {
  constructor(private readonly configService: ConfigService) {}

  async scrape(url: string): Promise<string | null> {
    try {
      return await this.scrapeWithRetry(url);
    } catch (error) {
      if (error instanceof FirecrawlScrapeError && this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async scrapeWithRetry(url: string): Promise<string | null> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.scrapeOnce(url);
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === MAX_RETRIES) {
          throw error;
        }
        await this.sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private async scrapeOnce(url: string): Promise<string | null> {
    const apiKey = this.configService.getOrThrow<string>('FIRECRAWL_API_KEY');
    const response = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    const body = (await response.json()) as FirecrawlScrapeResponse;

    if (!response.ok) {
      throw new FirecrawlScrapeError(
        body.error ?? `Firecrawl request failed with status ${response.status}`,
        response.status,
      );
    }

    if (!body.success) {
      throw new FirecrawlScrapeError(body.error ?? 'Firecrawl scrape failed');
    }

    const markdown = body.data?.markdown?.trim();
    return markdown ? markdown : null;
  }

  private isNotFound(error: FirecrawlScrapeError): boolean {
    return error.status === 404;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof FirecrawlScrapeError) {
      if (error.status === 404) {
        return false;
      }
      return (
        error.status === 429 ||
        (error.status !== undefined && error.status >= 500)
      );
    }
    return error instanceof TypeError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
