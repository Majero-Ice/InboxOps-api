import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeService } from '../claude/claude.service';
import { EnrichRequestDto } from './dto/enrich-request.dto';
import { EnrichResultDto } from './dto/enrich-result.dto';
import { FirecrawlService } from './firecrawl/firecrawl.service';

const MIN_MEANINGFUL_CONTENT_CHARS = 100;

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly firecrawlService: FirecrawlService,
    private readonly claudeService: ClaudeService,
  ) {}

  async enrich(dto: EnrichRequestDto): Promise<EnrichResultDto> {
    const startedAt = Date.now();
    const domain = this.normalizeDomain(dto.domain);
    const sourceUrl = `https://${domain}`;

    if (this.isPublicEmailDomain(domain)) {
      return this.buildSkippedResult(domain, sourceUrl, startedAt);
    }

    try {
      const markdown = await this.scrapeDomain(domain);

      if (!this.hasMeaningfulContent(markdown)) {
        return this.buildSkippedResult(domain, sourceUrl, startedAt);
      }

      const extraction = await this.claudeService.extractCompanyProfile(
        markdown,
        domain,
      );

      return {
        status: 'ok',
        domain,
        company: extraction.company,
        confidence: extraction.confidence,
        source_url: sourceUrl,
        meta: {
          model_used: extraction.model_used,
          processing_ms: Date.now() - startedAt,
        },
      };
    } catch (error) {
      this.logger.error(
        `Enrichment failed for ${domain}` +
          (dto.source_message_id ? ` (message ${dto.source_message_id})` : ''),
        error instanceof Error ? error.stack : String(error),
      );

      return this.buildFailedResult(domain, sourceUrl, error, startedAt);
    }
  }

  private async scrapeDomain(domain: string): Promise<string> {
    const homepageUrl = `https://${domain}`;
    const sections: string[] = [];
    const homepageMarkdown = await this.firecrawlService.scrape(homepageUrl);

    if (homepageMarkdown) {
      sections.push(homepageMarkdown);
    }

    for (const path of this.getAboutPaths()) {
      const aboutMarkdown = await this.firecrawlService.scrape(
        `https://${domain}${path}`,
      );
      if (aboutMarkdown) {
        sections.push(aboutMarkdown);
      }
    }

    const combined = sections.join('\n\n');
    const maxChars = this.config.get<number>('ENRICH_MAX_CHARS', 12000);
    return combined.slice(0, maxChars);
  }

  private normalizeDomain(domain: string): string {
    return domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
  }

  private isPublicEmailDomain(domain: string): boolean {
    const publicDomains = this.getPublicEmailDomains();
    return publicDomains.has(domain);
  }

  private getPublicEmailDomains(): Set<string> {
    const raw = this.config.get<string>(
      'PUBLIC_EMAIL_DOMAINS',
      'gmail.com,outlook.com,hotmail.com,yahoo.com,icloud.com,proton.me,protonmail.com,gmx.com,web.de,mail.ru,yandex.ru',
    );
    return new Set(
      raw
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private getAboutPaths(): string[] {
    const raw = this.config.get<string>(
      'ENRICH_ABOUT_PATHS',
      '/about,/about-us',
    );
    return raw
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => (path.startsWith('/') ? path : `/${path}`));
  }

  private hasMeaningfulContent(markdown: string): boolean {
    return markdown.trim().length >= MIN_MEANINGFUL_CONTENT_CHARS;
  }

  private buildSkippedResult(
    domain: string,
    sourceUrl: string,
    startedAt: number,
  ): EnrichResultDto {
    return {
      status: 'skipped',
      domain,
      company: null,
      confidence: 0,
      source_url: sourceUrl,
      meta: {
        model_used: null,
        processing_ms: Date.now() - startedAt,
      },
    };
  }

  private buildFailedResult(
    domain: string,
    sourceUrl: string,
    _error: unknown,
    startedAt: number,
  ): EnrichResultDto {
    return {
      status: 'enrichment_failed',
      domain,
      company: null,
      confidence: 0,
      source_url: sourceUrl,
      meta: {
        model_used: null,
        processing_ms: Date.now() - startedAt,
      },
    };
  }
}
