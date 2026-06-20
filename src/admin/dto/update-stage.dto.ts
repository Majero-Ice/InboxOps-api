import { IsIn, IsString } from 'class-validator';
import { LEAD_STAGES } from '../admin.types';

export class UpdateStageDto {
  @IsString()
  @IsIn(LEAD_STAGES)
  stage!: (typeof LEAD_STAGES)[number];
}
