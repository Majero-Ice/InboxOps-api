import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminAuthService } from './auth/admin-auth.service';

@Module({
  imports: [DbModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminAuthGuard],
})
export class AdminModule {}
