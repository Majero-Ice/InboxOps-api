import { ExtractedInvoiceDto } from '../invoice/dto/extracted-invoice.dto';

export interface ValidationDetails {
  structural_ok: boolean;
  arithmetic_ok: boolean;
  arithmetic_detail: string | null;
  issues: string[];
}

export type ProcessingRecommendation = 'ok' | 'needs_review';

export interface ValidationResult {
  invoice: ExtractedInvoiceDto;
  validation: ValidationDetails;
  recommendation: ProcessingRecommendation;
}
