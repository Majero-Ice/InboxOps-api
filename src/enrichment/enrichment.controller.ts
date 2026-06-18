import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { EnrichRequestDto } from './dto/enrich-request.dto';
import { EnrichResultDto } from './dto/enrich-result.dto';
import { EnrichmentService } from './enrichment.service';

@Controller()
export class EnrichmentController {
  constructor(private readonly enrichmentService: EnrichmentService) {}

  @Post('enrich')
  @HttpCode(200)
  @UseGuards(ApiKeyGuard)
  enrich(@Body() body: EnrichRequestDto): Promise<EnrichResultDto> {
    return this.enrichmentService.enrich(body);
  }
}
