import { Module } from '@nestjs/common';
import { ClaudeModule } from '../claude/claude.module';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { PdfModule } from '../pdf/pdf.module';
import { ValidationModule } from '../validation/validation.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [PdfModule, ClaudeModule, ValidationModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, ApiKeyGuard],
})
export class InvoiceModule {}
