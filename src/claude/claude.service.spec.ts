import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { APIError } from '@anthropic-ai/sdk';
import {
  ClaudeService,
  InvalidExtractionJsonError,
} from './claude.service';

const validExtractionJson = {
  confidence: 0.92,
  multiple_invoices: false,
  invoice: {
    invoice_number: 'INV-2024-001',
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
  },
};

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    APIError: class APIError extends Error {
      status: number;
      constructor(status: number, message = 'API error') {
        super(message);
        this.status = status;
      }
    },
    APIConnectionError: class APIConnectionError extends Error {},
    RateLimitError: class RateLimitError extends Error {
      status = 429;
    },
  };
});

function toolUseResponse(input: unknown, stopReason = 'tool_use') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'extract_invoice',
        input,
        caller: { type: 'direct' },
      },
    ],
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function textOnlyResponse(text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(async () => {
    mockCreate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const config: Record<string, string> = {
                ANTHROPIC_API_KEY: 'sk-ant-test',
                CLAUDE_TEXT_MODEL: 'claude-haiku-4-5-20251001',
                CLAUDE_VISION_MODEL: 'claude-sonnet-4-6',
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(ClaudeService);
  });

  describe('extractFromText', () => {
    it('returns parsed extraction from tool_use block', async () => {
      mockCreate.mockResolvedValue(toolUseResponse(validExtractionJson));

      const result = await service.extractFromText(
        'INVOICE #INV-2024-001\nVendor: Acme Corp\nTotal: 1650.00 USD',
      );

      expect(result).toMatchObject({
        ...validExtractionJson,
        model_used: 'claude-haiku-4-5-20251001',
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          system: expect.stringContaining('Return ONLY a single JSON object'),
          tools: [
            expect.objectContaining({ name: 'extract_invoice' }),
          ],
          tool_choice: { type: 'tool', name: 'extract_invoice' },
        }),
      );
    });

    it('retries when Claude returns no tool_use block', async () => {
      mockCreate
        .mockResolvedValueOnce(textOnlyResponse('not a tool call'))
        .mockResolvedValueOnce(toolUseResponse(validExtractionJson));

      const result = await service.extractFromText('invoice text');

      expect(result.invoice.invoice_number).toBe('INV-2024-001');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('retries on transient API errors', async () => {
      mockCreate
        .mockRejectedValueOnce(new APIError(429, 'rate limited'))
        .mockResolvedValueOnce(toolUseResponse(validExtractionJson));

      const result = await service.extractFromText('invoice text');

      expect(result.confidence).toBe(0.92);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('throws after retries are exhausted for missing tool_use', async () => {
      mockCreate.mockResolvedValue(textOnlyResponse('still not a tool call'));

      await expect(service.extractFromText('invoice text')).rejects.toBeInstanceOf(
        InvalidExtractionJsonError,
      );
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('extractFromImages', () => {
    it('sends PNG images to the vision model', async () => {
      mockCreate.mockResolvedValue(toolUseResponse(validExtractionJson));

      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const result = await service.extractFromImages([pngHeader]);

      expect(result.model_used).toBe('claude-sonnet-4-6');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          tools: [
            expect.objectContaining({ name: 'extract_invoice' }),
          ],
          tool_choice: { type: 'tool', name: 'extract_invoice' },
          messages: [
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                expect.objectContaining({
                  type: 'image',
                  source: expect.objectContaining({
                    type: 'base64',
                    media_type: 'image/png',
                    data: pngHeader.toString('base64'),
                  }),
                }),
              ]),
            }),
          ],
        }),
      );
    });
  });
});
