import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class RegisterDto {
  @ApiProperty({ maxLength: 150, example: 'Store Owner' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 150)
  fullName: string;

  @ApiProperty({ maxLength: 320, example: 'owner@example.com' })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    writeOnly: true,
    description:
      '12–128 characters, at least one non-whitespace character. Password whitespace is preserved.',
  })
  @IsString()
  @Length(12, 128)
  @Matches(/\S/u)
  password: string;
}
