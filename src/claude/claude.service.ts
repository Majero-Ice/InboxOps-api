import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import type {
  Message,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';
import {
  COMPANY_EXTRACTION_SYSTEM_PROMPT,
  COMPANY_EXTRACTION_USER_PROMPT,
} from '../enrichment/prompts/company-extraction.prompt';
import {
  ClaudeCompanyExtractionResult,
  ClaudeExtractionResult,
  RawCompanyExtraction,
  RawExtraction,
} from './claude.types';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TEXT_USER_PROMPT,
  EXTRACTION_VISION_USER_PROMPT,
} from './prompts/extraction.prompt';

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_OUTPUT_TOKENS = 4096;

const EXTRACT_INVOICE_TOOL: Tool = {
  name: 'extract_invoice',
  description: 'Extract structured invoice data from the document.',
  input_schema: {
    type: 'object',
    properties: {
      confidence: { type: 'number' },
      multiple_invoices: { type: 'boolean' },
      invoice: {
        type: 'object',
        properties: {
          invoice_number: { type: ['string', 'null'] },
          vendor: { type: ['string', 'null'] },
          issue_date: { type: ['string', 'null'] },
          due_date: { type: ['string', 'null'] },
          currency: { type: ['string', 'null'] },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                amount: { type: 'number' },
              },
              required: ['description', 'quantity', 'unit_price', 'amount'],
            },
          },
          subtotal: { type: 'number' },
          tax: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['line_items', 'subtotal', 'tax', 'total'],
      },
    },
    required: ['confidence', 'multiple_invoices', 'invoice'],
  },
};

const EXTRACT_INVOICE_TOOL_CHOICE = {
  type: 'tool' as const,
  name: 'extract_invoice',
};

const EXTRACT_COMPANY_TOOL: Tool = {
  name: 'extract_company_profile',
  description: 'Extract structured company profile data from website content.',
  input_schema: {
    type: 'object',
    properties: {
      confidence: { type: 'number' },
      company: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          industry: { type: ['string', 'null'] },
          size_hint: { type: ['string', 'null'] },
          products_services: {
            type: 'array',
            items: { type: 'string' },
          },
          location: { type: ['string', 'null'] },
          tone: { type: ['string', 'null'] },
        },
        required: ['products_services'],
      },
    },
    required: ['confidence', 'company'],
  },
};

const EXTRACT_COMPANY_TOOL_CHOICE = {
  type: 'tool' as const,
  name: 'extract_company_profile',
};

export class InvalidExtractionJsonError extends Error {
  constructor(message = 'Claude returned invalid or unparseable JSON') {
    super(message);
    this.name = 'InvalidExtractionJsonError';
  }
}

@Injectable()
export class ClaudeService {
  private readonly client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  async extractFromText(text: string): Promise<ClaudeExtractionResult> {
    const model = this.configService.getOrThrow<string>('CLAUDE_TEXT_MODEL');
    return this.callWithRetry(model, () =>
      this.client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: EXTRACTION_SYSTEM_PROMPT,
        tools: [EXTRACT_INVOICE_TOOL],
        tool_choice: EXTRACT_INVOICE_TOOL_CHOICE,
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_TEXT_USER_PROMPT}\n\n${text}`,
          },
        ],
      }),
      (response) => this.parseInvoiceResponse(response),
    );
  }

  async extractFromImages(images: Buffer[]): Promise<ClaudeExtractionResult> {
    const model = this.configService.getOrThrow<string>('CLAUDE_VISION_MODEL');
    const imageBlocks = images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: image.toString('base64'),
      },
    }));

    return this.callWithRetry(model, () =>
      this.client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: EXTRACTION_SYSTEM_PROMPT,
        tools: [EXTRACT_INVOICE_TOOL],
        tool_choice: EXTRACT_INVOICE_TOOL_CHOICE,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_VISION_USER_PROMPT },
              ...imageBlocks,
            ],
          },
        ],
      }),
      (response) => this.parseInvoiceResponse(response),
    );
  }

  async extractCompanyProfile(
    markdown: string,
    domain: string,
  ): Promise<ClaudeCompanyExtractionResult> {
    const model = this.configService.getOrThrow<string>('CLAUDE_TEXT_MODEL');
    return this.callWithRetry(model, () =>
      this.client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: COMPANY_EXTRACTION_SYSTEM_PROMPT,
        tools: [EXTRACT_COMPANY_TOOL],
        tool_choice: EXTRACT_COMPANY_TOOL_CHOICE,
        messages: [
          {
            role: 'user',
            content: `${COMPANY_EXTRACTION_USER_PROMPT(domain)}\n\n${markdown}`,
          },
        ],
      }),
      (response) => this.parseCompanyResponse(response),
    );
  }

  private async callWithRetry<T>(
    model: string,
    request: () => Promise<Message>,
    parse: (response: Message) => T,
  ): Promise<T & { model_used: string }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await request();
        const parsed = parse(response);
        return { ...parsed, model_used: model };
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === MAX_RETRIES) {
          throw error;
        }
        await this.sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }

    throw lastError;
  }

  private parseToolUseResponse(
    response: Message,
    toolName: string,
  ): unknown {
    if (response.stop_reason === 'max_tokens') {
      throw new InvalidExtractionJsonError('Response truncated by max_tokens');
    }

    const toolUseBlock = response.content.find(
      (block): block is ToolUseBlock =>
        block.type === 'tool_use' && block.name === toolName,
    );

    if (!toolUseBlock) {
      throw new InvalidExtractionJsonError('No tool_use block returned');
    }

    return toolUseBlock.input;
  }

  private parseInvoiceResponse(response: Message): RawExtraction {
    return this.validateRawExtraction(
      this.parseToolUseResponse(response, 'extract_invoice'),
    );
  }

  private parseCompanyResponse(response: Message): RawCompanyExtraction {
    return this.validateRawCompanyExtraction(
      this.parseToolUseResponse(response, 'extract_company_profile'),
    );
  }

  private validateRawExtraction(value: unknown): RawExtraction {
    if (!value || typeof value !== 'object') {
      throw new InvalidExtractionJsonError();
    }

    const record = value as Record<string, unknown>;
    const confidence = record.confidence;
    const multipleInvoices = record.multiple_invoices;
    const invoice = record.invoice;

    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw new InvalidExtractionJsonError('Missing or invalid confidence');
    }

    if (typeof multipleInvoices !== 'boolean') {
      throw new InvalidExtractionJsonError('Missing or invalid multiple_invoices');
    }

    if (!invoice || typeof invoice !== 'object') {
      throw new InvalidExtractionJsonError('Missing or invalid invoice object');
    }

    const invoiceRecord = invoice as Record<string, unknown>;
    const lineItems = invoiceRecord.line_items;

    if (!Array.isArray(lineItems)) {
      throw new InvalidExtractionJsonError('Missing or invalid line_items');
    }

    for (const item of lineItems) {
      if (!item || typeof item !== 'object') {
        throw new InvalidExtractionJsonError('Invalid line item');
      }
      const line = item as Record<string, unknown>;
      if (
        typeof line.description !== 'string' ||
        typeof line.quantity !== 'number' ||
        typeof line.unit_price !== 'number' ||
        typeof line.amount !== 'number'
      ) {
        throw new InvalidExtractionJsonError('Invalid line item fields');
      }
    }

    const numericFields = ['subtotal', 'tax', 'total'] as const;
    for (const field of numericFields) {
      if (typeof invoiceRecord[field] !== 'number') {
        throw new InvalidExtractionJsonError(`Missing or invalid ${field}`);
      }
    }

    const nullableStringFields = [
      'invoice_number',
      'vendor',
      'issue_date',
      'due_date',
      'currency',
    ] as const;

    for (const field of nullableStringFields) {
      const fieldValue = invoiceRecord[field];
      if (fieldValue !== null && typeof fieldValue !== 'string') {
        throw new InvalidExtractionJsonError(`Invalid ${field}`);
      }
    }

    return {
      confidence,
      multiple_invoices: multipleInvoices,
      invoice: {
        invoice_number: invoiceRecord.invoice_number as string | null,
        vendor: invoiceRecord.vendor as string | null,
        issue_date: invoiceRecord.issue_date as string | null,
        due_date: invoiceRecord.due_date as string | null,
        currency: invoiceRecord.currency as string | null,
        line_items: lineItems as RawExtraction['invoice']['line_items'],
        subtotal: invoiceRecord.subtotal as number,
        tax: invoiceRecord.tax as number,
        total: invoiceRecord.total as number,
      },
    };
  }

  private validateRawCompanyExtraction(value: unknown): RawCompanyExtraction {
    if (!value || typeof value !== 'object') {
      throw new InvalidExtractionJsonError();
    }

    const record = value as Record<string, unknown>;
    const confidence = record.confidence;
    const company = record.company;

    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw new InvalidExtractionJsonError('Missing or invalid confidence');
    }

    if (!company || typeof company !== 'object') {
      throw new InvalidExtractionJsonError('Missing or invalid company object');
    }

    const companyRecord = company as Record<string, unknown>;
    const productsServices = companyRecord.products_services;

    if (!Array.isArray(productsServices)) {
      throw new InvalidExtractionJsonError('Missing or invalid products_services');
    }

    for (const item of productsServices) {
      if (typeof item !== 'string') {
        throw new InvalidExtractionJsonError('Invalid products_services entry');
      }
    }

    const nullableStringFields = [
      'name',
      'description',
      'industry',
      'size_hint',
      'location',
      'tone',
    ] as const;

    for (const field of nullableStringFields) {
      const fieldValue = companyRecord[field];
      if (fieldValue !== null && typeof fieldValue !== 'string') {
        throw new InvalidExtractionJsonError(`Invalid ${field}`);
      }
    }

    return {
      confidence,
      company: {
        name: companyRecord.name as string | null,
        description: companyRecord.description as string | null,
        industry: companyRecord.industry as string | null,
        size_hint: companyRecord.size_hint as string | null,
        products_services: productsServices,
        location: companyRecord.location as string | null,
        tone: companyRecord.tone as string | null,
      },
    };
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof InvalidExtractionJsonError) {
      return true;
    }
    if (error instanceof APIConnectionError) {
      return true;
    }
    if (error instanceof APIError) {
      return error.status === 429 || error.status >= 500;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
