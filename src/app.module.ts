import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/config/env.validation';
import { AdminModule } from './admin/admin.module';
import { ClaudeModule } from './claude/claude.module';
import { DbModule } from './db/db.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { HealthController } from './health/health.controller';
import { InvoiceModule } from './invoice/invoice.module';
import { PdfModule } from './pdf/pdf.module';
import { ValidationModule } from './validation/validation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    InvoiceModule,
    PdfModule,
    ClaudeModule,
    ValidationModule,
    EnrichmentModule,
    DbModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
