import { IsFQDN, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EnrichRequestDto {
  @IsString()
  @IsNotEmpty()
  @IsFQDN({ require_tld: true })
  domain!: string;

  @IsOptional()
  @IsString()
  source_message_id?: string;
}
