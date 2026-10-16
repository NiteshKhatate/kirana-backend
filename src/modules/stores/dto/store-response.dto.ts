import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma, StoreStatus } from '@prisma/client';

export const publicStoreSelect = {
  id: true,
  organizationId: true,
  code: true,
  name: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreSelect;

export class StoreResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true, type: String }) phone: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) addressLine1:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) addressLine2:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) city: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) state: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) postalCode:
    string | null;
  @ApiProperty() country: string;
  @ApiProperty({ enum: StoreStatus }) status: StoreStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
