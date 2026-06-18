export type EnrichmentStatus = 'ok' | 'skipped' | 'enrichment_failed';

export interface CompanyProfileDto {
  name: string | null;
  description: string | null;
  industry: string | null;
  size_hint: string | null;
  products_services: string[];
  location: string | null;
  tone: string | null;
}

export interface EnrichmentMeta {
  model_used: string | null;
  processing_ms: number;
}

export interface EnrichResultDto {
  status: EnrichmentStatus;
  domain: string;
  company: CompanyProfileDto | null;
  confidence: number;
  source_url: string;
  meta: EnrichmentMeta;
}
