import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeService } from '../claude/claude.service';
import { ClaudeExtractionResult } from '../claude/claude.types';
import { PdfService } from '../pdf/pdf.service';
import { PdfType } from '../pdf/pdf.types';
import { ValidationService } from '../validation/validation.service';
import { NOT_AN_INVOICE_ISSUE } from '../validation/validation.service';
import {
  InvoiceResultDto,
  InvoiceStatus,
  PdfTypeResult,
} from './dto/invoice-result.dto';
import { ProcessInvoiceDto } from './dto/process-invoice.dto';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly pdfService: PdfService,
    private readonly claudeService: ClaudeService,
    private readonly validationService: ValidationService,
  ) {}

  async process(dto: ProcessInvoiceDto): Promise<InvoiceResultDto> {
    const startedAt = Date.now();
    const buffer = this.decodeFile(dto.file);
    let pdfType: PdfTypeResult = 'unknown';

    try {
      const detectedType = await this.pdfService.detectType(buffer);
      pdfType = detectedType;

      const { extraction, issues } = await this.extract(detectedType, buffer);

      const validationResult = await this.validationService.validate(extraction);
      const allIssues = [...issues, ...validationResult.validation.issues];

      const status = this.decideStatus(
        extraction,
        validationResult,
        allIssues,
      );

      return {
        status,
        pdf_type: pdfType,
        confidence: extraction.confidence,
        invoice: validationResult.invoice,
        validation: {
          ...validationResult.validation,
          issues: allIssues,
        },
        meta: {
          model_used: extraction.model_used,
          processing_ms: Date.now() - startedAt,
        },
      };
    } catch (error) {
      this.logger.error(
        `Extraction failed for ${dto.filename ?? 'unknown file'}` +
          (dto.source_message_id ? ` (message ${dto.source_message_id})` : ''),
        error instanceof Error ? error.stack : String(error),
      );

      return this.buildFailedResult(pdfType, error, startedAt);
    }
  }

  private async extract(
    pdfType: PdfType,
    buffer: Buffer,
  ): Promise<{ extraction: ClaudeExtractionResult; issues: string[] }> {
    if (pdfType === 'text') {
      const text = await this.pdfService.extractText(buffer);
      const extraction = await this.claudeService.extractFromText(text);
      return { extraction, issues: [] };
    }

    const images = await this.pdfService.renderPagesToImages(buffer);
    const issues: string[] = [];
    const maxPages = this.config.get<number>('PDF_MAX_VISION_PAGES', 5);

    if (images.length >= maxPages) {
      issues.push(
        `Only the first ${maxPages} page(s) were sent to vision (PDF_MAX_VISION_PAGES cap).`,
      );
    }

    const extraction = await this.claudeService.extractFromImages(images);
    return { extraction, issues };
  }

  private decideStatus(
    extraction: ClaudeExtractionResult,
    validationResult: Awaited<ReturnType<ValidationService['validate']>>,
    issues: string[],
  ): InvoiceStatus {
    if (this.validationService.isNotAnInvoice(extraction.invoice)) {
      issues.push(NOT_AN_INVOICE_ISSUE);
      return 'not_an_invoice';
    }

    if (validationResult.recommendation === 'needs_review') {
      return 'needs_review';
    }

    if (!this.validationService.isConfidenceAcceptable(extraction.confidence)) {
      issues.push(
        `Confidence ${extraction.confidence} is below the acceptance threshold.`,
      );
      return 'needs_review';
    }

    if (extraction.multiple_invoices) {
      issues.push('Multiple invoices detected in a single PDF.');
      return 'needs_review';
    }

    return 'ok';
  }

  private decodeFile(file: string): Buffer {
    const buffer = Buffer.from(file, 'base64');
    const maxMb = this.config.get<number>('MAX_UPLOAD_MB', 15);
    const maxBytes = maxMb * 1024 * 1024;

    if (buffer.length > maxBytes) {
      throw new PayloadTooLargeException(
        `Decoded file exceeds the ${maxMb} MB limit.`,
      );
    }

    return buffer;
  }

  private buildFailedResult(
    pdfType: PdfTypeResult,
    error: unknown,
    startedAt: number,
  ): InvoiceResultDto {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      status: 'extraction_failed',
      pdf_type: pdfType,
      confidence: 0,
      invoice: null,
      validation: {
        structural_ok: false,
        arithmetic_ok: false,
        arithmetic_detail: null,
        issues: [`Extraction failed: ${message}`],
      },
      meta: {
        model_used: null,
        processing_ms: Date.now() - startedAt,
      },
    };
  }
}
