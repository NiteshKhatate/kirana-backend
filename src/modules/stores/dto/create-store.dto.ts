import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class CreateStoreDto {
  @ApiProperty({
    maxLength: 40,
    example: 'MAIN',
    description:
      'Stable organization-scoped code. Identical normalized retries resume the existing store; changed payload returns 409.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(1, 40)
  @Matches(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/)
  code: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  @Matches(/^\+?[0-9 ()-]+$/)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  addressLine1?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  addressLine2?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  city?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  state?: string;

  @ApiPropertyOptional({ maxLength: 12 })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 12)
  @Matches(/^[A-Za-z0-9 -]+$/)
  postalCode?: string;

  @ApiPropertyOptional({
    default: 'IN',
    description: 'ISO 3166-1 alpha-2 country code.',
  })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsISO31661Alpha2()
  country?: string;
}
