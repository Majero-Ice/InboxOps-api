import { ExtractedInvoiceDto } from './extracted-invoice.dto';

export type InvoiceStatus =
  | 'ok'
  | 'needs_review'
  | 'not_an_invoice'
  | 'extraction_failed';

export type PdfTypeResult = 'text' | 'scanned' | 'unknown';

export interface InvoiceValidationResult {
  structural_ok: boolean;
  arithmetic_ok: boolean;
  arithmetic_detail: string | null;
  issues: string[];
}

export interface InvoiceResultMeta {
  model_used: string | null;
  processing_ms: number;
}

export interface InvoiceResultDto {
  status: InvoiceStatus;
  pdf_type: PdfTypeResult;
  confidence: number;
  invoice: ExtractedInvoiceDto | null;
  validation: InvoiceValidationResult;
  meta: InvoiceResultMeta;
}
