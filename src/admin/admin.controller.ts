import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminAuthService } from './auth/admin-auth.service';
import { Public } from './auth/public.decorator';
import { LoginDto } from './dto/login.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { LEAD_STAGES } from './admin.types';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: LoginDto) {
    return this.adminAuthService.login(body.password);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('leads')
  listLeads(@Query('stage') stage?: string) {
    if (stage && !LEAD_STAGES.includes(stage as (typeof LEAD_STAGES)[number])) {
      return [];
    }
    return this.adminService.listLeads(
      stage as (typeof LEAD_STAGES)[number] | undefined,
    );
  }

  @Get('leads/:id')
  getLead(@Param('id') id: string) {
    return this.adminService.getLeadDetails(id);
  }

  @Patch('leads/:id/stage')
  updateStage(@Param('id') id: string, @Body() body: UpdateStageDto) {
    return this.adminService.updateLeadStage(id, body.stage);
  }
}
