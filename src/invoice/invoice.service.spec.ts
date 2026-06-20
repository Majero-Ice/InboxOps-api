import { PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClaudeService } from '../claude/claude.service';
import { ClaudeExtractionResult } from '../claude/claude.types';
import { PdfService } from '../pdf/pdf.service';
import { ValidationService } from '../validation/validation.service';
import { ProcessInvoiceDto } from './dto/process-invoice.dto';
import { InvoiceService } from './invoice.service';

function buildExtraction(
  invoiceOverrides: Partial<ClaudeExtractionResult['invoice']> = {},
  overrides: Partial<Omit<ClaudeExtractionResult, 'invoice'>> = {},
): ClaudeExtractionResult {
  return {
    confidence: 0.95,
    multiple_invoices: false,
    model_used: 'claude-haiku-test',
    invoice: {
      invoice_number: 'INV-001',
      vendor: 'Acme Corp',
      issue_date: '2024-01-15',
      due_date: '2024-02-15',
      currency: 'USD',
      line_items: [
        {
          description: 'Consulting',
          quantity: 10,
          unit_price: 150,
          amount: 1500,
        },
      ],
      subtotal: 1500,
      tax: 150,
      total: 1650,
      ...invoiceOverrides,
    },
    ...overrides,
  };
}

function dtoFor(text: string): ProcessInvoiceDto {
  return { file: Buffer.from(text).toString('base64'), filename: 'invoice.pdf' };
}

describe('InvoiceService', () => {
  let service: InvoiceService;
  let pdfService: jest.Mocked<Pick<PdfService, 'detectType' | 'extractText' | 'renderPagesToImages'>>;
  let claudeService: jest.Mocked<Pick<ClaudeService, 'extractFromText' | 'extractFromImages'>>;

  beforeEach(async () => {
    pdfService = {
      detectType: jest.fn(),
      extractText: jest.fn(),
      renderPagesToImages: jest.fn(),
    };
    claudeService = {
      extractFromText: jest.fn(),
      extractFromImages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        ValidationService,
        { provide: PdfService, useValue: pdfService },
        { provide: ClaudeService, useValue: claudeService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                CONFIDENCE_THRESHOLD: 0.7,
                MAX_UPLOAD_MB: 15,
                PDF_MAX_VISION_PAGES: 5,
              };
              return key in config ? config[key] : defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = module.get(InvoiceService);
  });

  it('returns ok for a clean, consistent text invoice', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('INVOICE #INV-001 Total 1650');
    claudeService.extractFromText.mockResolvedValue(buildExtraction());

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('ok');
    expect(result.pdf_type).toBe('text');
    expect(result.invoice?.invoice_number).toBe('INV-001');
    expect(result.validation.arithmetic_ok).toBe(true);
    expect(result.meta.model_used).toBe('claude-haiku-test');
    expect(claudeService.extractFromText).toHaveBeenCalledTimes(1);
  });

  it('returns needs_review with arithmetic_detail when line items do not sum to total', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('invoice text');
    claudeService.extractFromText.mockResolvedValue(
      buildExtraction({ total: 1200 }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('needs_review');
    expect(result.validation.arithmetic_ok).toBe(false);
    expect(result.validation.arithmetic_detail).toBe(
      'sum of line items (1500.00) + tax (150.00) != total (1200.00)',
    );
  });

  it('routes scanned PDFs through the vision path', async () => {
    pdfService.detectType.mockResolvedValue('scanned');
    pdfService.renderPagesToImages.mockResolvedValue([Buffer.from('img')]);
    claudeService.extractFromImages.mockResolvedValue(
      buildExtraction({}, { model_used: 'claude-sonnet-test' }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('ok');
    expect(result.pdf_type).toBe('scanned');
    expect(result.meta.model_used).toBe('claude-sonnet-test');
    expect(claudeService.extractFromImages).toHaveBeenCalledTimes(1);
    expect(claudeService.extractFromText).not.toHaveBeenCalled();
  });

  it('returns needs_review when confidence is below the threshold', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('invoice text');
    claudeService.extractFromText.mockResolvedValue(
      buildExtraction({}, { confidence: 0.5 }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('needs_review');
  });

  it('returns needs_review when multiple invoices are detected', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('invoice text');
    claudeService.extractFromText.mockResolvedValue(
      buildExtraction({}, { multiple_invoices: true }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('needs_review');
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        'Multiple invoices detected in a single PDF.',
      ]),
    );
  });

  it('returns extraction_failed (no throw) when the PDF cannot be parsed', async () => {
    pdfService.detectType.mockRejectedValue(new Error('corrupt pdf'));

    const result = await service.process(dtoFor('not-a-pdf'));

    expect(result.status).toBe('extraction_failed');
    expect(result.pdf_type).toBe('unknown');
    expect(result.invoice).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining(['Extraction failed: corrupt pdf']),
    );
  });

  it('returns not_an_invoice when no critical fields are present', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('random document text');
    claudeService.extractFromText.mockResolvedValue(
      buildExtraction({
        invoice_number: null,
        vendor: null,
        total: 0,
        line_items: [],
        subtotal: 0,
        tax: 0,
      }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('not_an_invoice');
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        'No invoice number, vendor, or total could be extracted — document does not appear to be an invoice',
      ]),
    );
  });

  it('returns needs_review (not not_an_invoice) when only vendor is missing but total exists', async () => {
    pdfService.detectType.mockResolvedValue('text');
    pdfService.extractText.mockResolvedValue('invoice text');
    claudeService.extractFromText.mockResolvedValue(
      buildExtraction({
        invoice_number: 'INV-001',
        vendor: null,
        total: 1200,
      }),
    );

    const result = await service.process(dtoFor('pdf-bytes'));

    expect(result.status).toBe('needs_review');
    expect(result.status).not.toBe('not_an_invoice');
  });

  it('rejects oversized decoded payloads with 413', async () => {
    const oversized = 'a'.repeat(16 * 1024 * 1024);

    await expect(
      service.process({ file: Buffer.from(oversized).toString('base64') }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
