import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from './register.dto';

export class ResendVerificationDto {
  @ApiProperty({ maxLength: 320, example: 'owner@example.com' })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(320)
  email: string;
}
