import { Module } from '@nestjs/common';
import { ClaudeModule } from '../claude/claude.module';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { EnrichmentController } from './enrichment.controller';
import { EnrichmentService } from './enrichment.service';
import { FirecrawlService } from './firecrawl/firecrawl.service';

@Module({
  imports: [ClaudeModule],
  controllers: [EnrichmentController],
  providers: [EnrichmentService, FirecrawlService, ApiKeyGuard],
})
export class EnrichmentModule {}
