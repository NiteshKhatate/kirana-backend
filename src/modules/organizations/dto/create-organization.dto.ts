import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { normalizeEmail } from '../../auth/dto/register.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOrganizationDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({
    maxLength: 100,
    example: 'my-kirana',
    description:
      'Required stable identifier for retries. Same creator and identical normalized payload resume the original organization; collisions return 409.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  businessType?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  @Matches(/^\+?[0-9 ()-]+$/)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 320 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value))
  @IsEmail()
  @Length(1, 320)
  email?: string;

  @ApiPropertyOptional({ minLength: 15, maxLength: 15 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
  gstin?: string;
}
