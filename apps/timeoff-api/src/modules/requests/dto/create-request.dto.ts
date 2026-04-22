import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRequestBody {
  @IsString() @IsNotEmpty() locationId!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsString() @IsNotEmpty() idempotencyKey!: string;
}

export class RejectRequestBody {
  @IsOptional() @IsString() reason?: string;
}

export class ForceFailBody {
  @IsString() @IsNotEmpty() reason!: string;
}
