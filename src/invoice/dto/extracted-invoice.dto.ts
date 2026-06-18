import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const ALLOWED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'JPY',
  'CNY',
  'INR',
  'MXN',
  'BRL',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'NZD',
  'SGD',
  'HKD',
  'KRW',
  'ZAR',
] as const;

export class ExtractedInvoiceLineItemDto {
  @IsString()
  description!: string;

  @IsNumber()
  quantity!: number;

  @IsNumber()
  unit_price!: number;

  @IsNumber()
  amount!: number;
}

export class ExtractedInvoiceDto {
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  invoice_number!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  vendor!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'issue_date must be YYYY-MM-DD',
  })
  issue_date!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'due_date must be YYYY-MM-DD',
  })
  due_date!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsIn(ALLOWED_CURRENCIES, {
    message: 'currency must be a supported ISO 4217 code or null',
  })
  currency!: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedInvoiceLineItemDto)
  line_items!: ExtractedInvoiceLineItemDto[];

  @IsNumber()
  subtotal!: number;

  @IsNumber()
  tax!: number;

  @IsNumber()
  @Min(0, { message: 'total must not be negative' })
  total!: number;
}
