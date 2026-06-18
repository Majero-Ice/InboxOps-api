import { Module } from '@nestjs/common';

// Planned: POST /enrich endpoint. Phase 2a = Firecrawl (managed API) to enrich
// sender/company data from a domain. Phase 2b = custom Playwright scraper with
// Firecrawl as fallback. n8n will call this endpoint; the service performs the
// scraping/enrichment and returns normalized data. Stateless, like the invoice flow.

@Module({})
export class EnrichmentModule {}
