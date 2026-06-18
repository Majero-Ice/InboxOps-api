import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { InvoiceResultDto } from './dto/invoice-result.dto';
import { ProcessInvoiceDto } from './dto/process-invoice.dto';
import { InvoiceService } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post('process')
  @HttpCode(200)
  @UseGuards(ApiKeyGuard)
  process(@Body() body: ProcessInvoiceDto): Promise<InvoiceResultDto> {
    return this.invoiceService.process(body);
  }
}
