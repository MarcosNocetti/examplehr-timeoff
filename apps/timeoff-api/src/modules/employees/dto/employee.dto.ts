import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Role } from '@examplehr/contracts';

export class CreateEmployeeBody {
  @IsString() @IsNotEmpty() name!: string;
  @IsEmail() email!: string;
  @IsIn(Object.values(Role)) role!: Role;
  @IsOptional() @IsString() managerId?: string | null;
}

export class UpdateEmployeeBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(Object.values(Role)) role?: Role;
  @IsOptional() managerId?: string | null;  // null explicitly clears
}
