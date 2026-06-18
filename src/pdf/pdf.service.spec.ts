import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfService } from './pdf.service';

async function createTextInvoicePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'INVOICE #INV-2024-001',
    'Vendor: Acme Corporation',
    'Issue Date: 2024-01-15',
    'Due Date: 2024-02-15',
    'Description          Qty    Unit Price    Amount',
    'Consulting services    10      150.00    1500.00',
    'Design review           5       80.00     400.00',
    'Subtotal: 1900.00',
    'Tax: 190.00',
    'Total: 2090.00 USD',
  ];
  let y = 700;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 24;
  }
  return Buffer.from(await doc.save());
}

async function createScannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

async function createMultiPagePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1} of invoice scan`, {
      x: 50,
      y: 700,
      size: 12,
      font,
    });
  }
  return Buffer.from(await doc.save());
}

describe('PdfService', () => {
  let service: PdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: number) => {
              const config: Record<string, number> = {
                PDF_TEXT_MIN_CHARS: 100,
                PDF_MAX_VISION_PAGES: 3,
              };
              return config[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = module.get(PdfService);
  });

  describe('detectType', () => {
    it('classifies a text-based invoice PDF as text', async () => {
      const buffer = await createTextInvoicePdf();
      await expect(service.detectType(buffer)).resolves.toBe('text');
    });

    it('classifies a blank scanned PDF as scanned', async () => {
      const buffer = await createScannedPdf();
      await expect(service.detectType(buffer)).resolves.toBe('scanned');
    });
  });

  describe('extractText', () => {
    it('extracts readable text from a text-based invoice PDF', async () => {
      const buffer = await createTextInvoicePdf();
      const text = await service.extractText(buffer);
      expect(text).toContain('INVOICE #INV-2024-001');
      expect(text).toContain('Acme Corporation');
      expect(text).toContain('2090.00');
    });

    it('returns little or no text from a blank scanned PDF', async () => {
      const buffer = await createScannedPdf();
      const text = await service.extractText(buffer);
      expect(text.trim().length).toBeLessThan(100);
    });
  });

  describe('renderPagesToImages', () => {
    it('renders scanned PDF pages to PNG buffers', async () => {
      const buffer = await createScannedPdf();
      const images = await service.renderPagesToImages(buffer);
      expect(images).toHaveLength(1);
      expect(images[0].subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('caps rendered pages at PDF_MAX_VISION_PAGES', async () => {
      const buffer = await createMultiPagePdf(5);
      const images = await service.renderPagesToImages(buffer);
      expect(images).toHaveLength(3);
    });
  });
});
