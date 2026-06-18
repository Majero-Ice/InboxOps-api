import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { RawExtraction, RawInvoice } from '../claude/claude.types';
import { ExtractedInvoiceDto } from '../invoice/dto/extracted-invoice.dto';
import {
  ProcessingRecommendation,
  ValidationResult,
} from './validation.types';

const ARITHMETIC_TOLERANCE = 0.02;
const MAX_FUTURE_DAYS = 30;

@Injectable()
export class ValidationService {
  constructor(private readonly config: ConfigService) {}

  async validate(extraction: RawExtraction): Promise<ValidationResult> {
    const issues: string[] = [];
    const invoiceDto = plainToInstance(ExtractedInvoiceDto, extraction.invoice);
    const classErrors = await validate(invoiceDto);

    if (classErrors.length > 0) {
      issues.push(...this.flattenValidationErrors(classErrors));
    }

    let structuralOk = classErrors.length === 0;

    if (!this.hasValidTotal(extraction.invoice)) {
      structuralOk = false;
      if (!issues.some((issue) => issue.includes('total'))) {
        issues.push('Missing or invalid required field: total');
      }
    }

    if (!this.hasCriticalIdentifier(extraction.invoice)) {
      structuralOk = false;
      issues.push(
        'Missing critical field: either invoice_number or vendor is required',
      );
    }

    for (const issue of this.collectDateIssues(extraction.invoice)) {
      issues.push(issue);
    }

    const { arithmeticOk, arithmeticDetail } = this.checkArithmetic(
      extraction.invoice,
    );

    const recommendation: ProcessingRecommendation =
      structuralOk && arithmeticOk ? 'ok' : 'needs_review';

    return {
      invoice: invoiceDto,
      validation: {
        structural_ok: structuralOk,
        arithmetic_ok: arithmeticOk,
        arithmetic_detail: arithmeticDetail,
        issues,
      },
      recommendation,
    };
  }

  isConfidenceAcceptable(confidence: number): boolean {
    const threshold = this.config.get<number>('CONFIDENCE_THRESHOLD', 0.7);
    return confidence >= threshold;
  }

  private hasValidTotal(invoice: RawInvoice): boolean {
    return typeof invoice.total === 'number' && !Number.isNaN(invoice.total);
  }

  private hasCriticalIdentifier(invoice: RawInvoice): boolean {
    const invoiceNumber = invoice.invoice_number?.trim();
    const vendor = invoice.vendor?.trim();
    return Boolean(invoiceNumber || vendor);
  }

  private checkArithmetic(invoice: RawInvoice): {
    arithmeticOk: boolean;
    arithmeticDetail: string | null;
  } {
    const lineItemSum = invoice.line_items.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const tax = invoice.tax ?? 0;
    const expectedTotal = lineItemSum + tax;
    const actualTotal = invoice.total ?? 0;
    const diff = Math.abs(expectedTotal - actualTotal);

    if (diff <= ARITHMETIC_TOLERANCE) {
      return { arithmeticOk: true, arithmeticDetail: null };
    }

    return {
      arithmeticOk: false,
      arithmeticDetail: `sum of line items (${lineItemSum.toFixed(2)}) + tax (${tax.toFixed(2)}) != total (${actualTotal.toFixed(2)})`,
    };
  }

  private collectDateIssues(invoice: RawInvoice): string[] {
    const issues: string[] = [];
    const maxFuture = new Date();
    maxFuture.setUTCDate(maxFuture.getUTCDate() + MAX_FUTURE_DAYS);

    if (invoice.issue_date && !this.isValidCalendarDate(invoice.issue_date)) {
      issues.push(`issue_date (${invoice.issue_date}) is not a valid date`);
    }

    if (invoice.due_date && !this.isValidCalendarDate(invoice.due_date)) {
      issues.push(`due_date (${invoice.due_date}) is not a valid date`);
    }

    const issueDate = invoice.issue_date
      ? this.parseDate(invoice.issue_date)
      : null;
    const dueDate = invoice.due_date ? this.parseDate(invoice.due_date) : null;

    if (issueDate && issueDate > maxFuture) {
      issues.push(
        `issue_date (${invoice.issue_date}) is unusually far in the future`,
      );
    }

    if (issueDate && dueDate && dueDate < issueDate) {
      issues.push(
        `due_date (${invoice.due_date}) is before issue_date (${invoice.issue_date})`,
      );
    }

    return issues;
  }

  private isValidCalendarDate(value: string): boolean {
    return this.parseDate(value) !== null;
  }

  private parseDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date;
  }

  private flattenValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];

    for (const error of errors) {
      if (error.constraints) {
        messages.push(
          ...Object.values(error.constraints).map(
            (message) => `${error.property}: ${message}`,
          ),
        );
      }

      if (error.children?.length) {
        messages.push(...this.flattenValidationErrors(error.children));
      }
    }

    return messages;
  }
}
