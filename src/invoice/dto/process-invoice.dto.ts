import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProcessInvoiceDto {
  @IsString()
  @IsNotEmpty()
  file!: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  source_message_id?: string;
}
