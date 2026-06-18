import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RawExtraction } from '../claude/claude.types';
import { ValidationService } from './validation.service';

function buildExtraction(
  overrides: Partial<RawExtraction['invoice']> = {},
  extractionOverrides: Partial<Omit<RawExtraction, 'invoice'>> = {},
): RawExtraction {
  return {
    confidence: 0.9,
    multiple_invoices: false,
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
      ...overrides,
    },
    ...extractionOverrides,
  };
}

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => {
              if (key === 'CONFIDENCE_THRESHOLD') {
                return 0.7;
              }
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    service = module.get(ValidationService);
  });

  describe('validate', () => {
    it('returns ok recommendation when structure and arithmetic match', async () => {
      const result = await service.validate(buildExtraction());

      expect(result.validation.structural_ok).toBe(true);
      expect(result.validation.arithmetic_ok).toBe(true);
      expect(result.validation.arithmetic_detail).toBeNull();
      expect(result.recommendation).toBe('ok');
      expect(result.validation.issues).toEqual([]);
    });

    it('flags arithmetic mismatch with detail', async () => {
      const result = await service.validate(
        buildExtraction({
          total: 1200,
        }),
      );

      expect(result.validation.arithmetic_ok).toBe(false);
      expect(result.validation.arithmetic_detail).toBe(
        'sum of line items (1500.00) + tax (150.00) != total (1200.00)',
      );
      expect(result.recommendation).toBe('needs_review');
    });

    it('accepts totals within the arithmetic tolerance', async () => {
      const result = await service.validate(
        buildExtraction({
          total: 1650.01,
        }),
      );

      expect(result.validation.arithmetic_ok).toBe(true);
      expect(result.recommendation).toBe('ok');
    });

    it('requires either invoice_number or vendor', async () => {
      const result = await service.validate(
        buildExtraction({
          invoice_number: null,
          vendor: null,
        }),
      );

      expect(result.validation.structural_ok).toBe(false);
      expect(result.recommendation).toBe('needs_review');
      expect(result.validation.issues).toEqual(
        expect.arrayContaining([
          'Missing critical field: either invoice_number or vendor is required',
        ]),
      );
    });

    it('rejects unsupported currency codes', async () => {
      const result = await service.validate(
        buildExtraction({
          currency: 'XYZ',
        }),
      );

      expect(result.validation.structural_ok).toBe(false);
      expect(result.validation.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining('currency'),
        ]),
      );
    });

    it('warns when due_date is before issue_date without failing structure', async () => {
      const result = await service.validate(
        buildExtraction({
          issue_date: '2024-03-01',
          due_date: '2024-02-01',
        }),
      );

      expect(result.validation.structural_ok).toBe(true);
      expect(result.validation.issues).toEqual(
        expect.arrayContaining([
          'due_date (2024-02-01) is before issue_date (2024-03-01)',
        ]),
      );
    });
  });

  describe('isConfidenceAcceptable', () => {
    it('accepts confidence at or above the threshold', () => {
      expect(service.isConfidenceAcceptable(0.7)).toBe(true);
      expect(service.isConfidenceAcceptable(0.85)).toBe(true);
    });

    it('rejects confidence below the threshold', () => {
      expect(service.isConfidenceAcceptable(0.69)).toBe(false);
      expect(service.isConfidenceAcceptable(0)).toBe(false);
    });
  });
});
