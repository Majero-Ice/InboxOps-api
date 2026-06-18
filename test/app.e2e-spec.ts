import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { InvalidExtractionJsonError } from '../src/claude/claude.service';
import { ClaudeExtractionResult } from '../src/claude/claude.types';
import { createTextInvoicePdf } from './fixtures/invoice-pdf';
import { createTestApp } from './helpers/create-test-app';

const cleanExtraction: ClaudeExtractionResult = {
  confidence: 0.95,
  multiple_invoices: false,
  model_used: 'claude-haiku-test',
  invoice: {
    invoice_number: 'INV-2024-001',
    vendor: 'Acme Corporation',
    issue_date: '2024-01-15',
    due_date: '2024-02-15',
    currency: 'USD',
    line_items: [
      {
        description: 'Consulting services',
        quantity: 10,
        unit_price: 150,
        amount: 1500,
      },
      {
        description: 'Design review',
        quantity: 5,
        unit_price: 80,
        amount: 400,
      },
    ],
    subtotal: 1900,
    tax: 190,
    total: 2090,
  },
};

const mismatchExtraction: ClaudeExtractionResult = {
  ...cleanExtraction,
  invoice: {
    ...cleanExtraction.invoice,
    total: 1200,
  },
};

describe('Invoice Service (e2e)', () => {
  let app: INestApplication<App>;
  let pdfBase64: string;

  beforeAll(async () => {
    pdfBase64 = (await createTextInvoicePdf()).toString('base64');
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /health', () => {
    beforeEach(async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest.fn(),
          extractFromImages: jest.fn(),
        },
      });
    });

    it('returns 200', () => {
      return request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('POST /invoices/process auth', () => {
    beforeEach(async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest.fn(),
          extractFromImages: jest.fn(),
        },
      });
    });

    it('returns 401 without an API key', () => {
      return request(app.getHttpServer())
        .post('/invoices/process')
        .send({ file: pdfBase64 })
        .expect(401);
    });

    it('returns 401 with an invalid API key', () => {
      return request(app.getHttpServer())
        .post('/invoices/process')
        .set('x-api-key', 'wrong-key')
        .send({ file: pdfBase64 })
        .expect(401);
    });
  });

  describe('POST /invoices/process outcomes', () => {
    it('returns status ok for a clean, consistent invoice', async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest.fn().mockResolvedValue(cleanExtraction),
          extractFromImages: jest.fn(),
        },
      });

      const response = await request(app.getHttpServer())
        .post('/invoices/process')
        .set('x-api-key', 'test-api-key')
        .send({ file: pdfBase64, filename: 'invoice.pdf' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.pdf_type).toBe('text');
      expect(response.body.invoice.invoice_number).toBe('INV-2024-001');
      expect(response.body.validation.arithmetic_ok).toBe(true);
      expect(response.body.meta.model_used).toBe('claude-haiku-test');
    });

    it('returns needs_review with arithmetic_detail when totals do not reconcile', async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest.fn().mockResolvedValue(mismatchExtraction),
          extractFromImages: jest.fn(),
        },
      });

      const response = await request(app.getHttpServer())
        .post('/invoices/process')
        .set('x-api-key', 'test-api-key')
        .send({ file: pdfBase64 })
        .expect(200);

      expect(response.body.status).toBe('needs_review');
      expect(response.body.validation.arithmetic_ok).toBe(false);
      expect(response.body.validation.arithmetic_detail).toBe(
        'sum of line items (1900.00) + tax (190.00) != total (1200.00)',
      );
    });

    it('returns extraction_failed when Claude output is unparseable', async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest
            .fn()
            .mockRejectedValue(new InvalidExtractionJsonError()),
          extractFromImages: jest.fn(),
        },
      });

      const response = await request(app.getHttpServer())
        .post('/invoices/process')
        .set('x-api-key', 'test-api-key')
        .send({ file: pdfBase64 })
        .expect(200);

      expect(response.body.status).toBe('extraction_failed');
      expect(response.body.invoice).toBeNull();
      expect(response.body.validation.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Extraction failed'),
        ]),
      );
    });

    it('returns extraction_failed for a corrupt PDF without crashing', async () => {
      app = await createTestApp({
        claudeService: {
          extractFromText: jest.fn(),
          extractFromImages: jest.fn(),
        },
      });

      const corruptPdf = Buffer.from('not-a-valid-pdf').toString('base64');

      const response = await request(app.getHttpServer())
        .post('/invoices/process')
        .set('x-api-key', 'test-api-key')
        .send({ file: corruptPdf })
        .expect(200);

      expect(response.body.status).toBe('extraction_failed');
      expect(response.body.invoice).toBeNull();
    });
  });
});
