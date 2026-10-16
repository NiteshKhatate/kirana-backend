import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';

export const publicOrganizationSelect = {
  id: true,
  name: true,
  slug: true,
  businessType: true,
  phone: true,
  email: true,
  gstin: true,
  timezone: true,
  currency: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

export class OrganizationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true, type: String }) businessType:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) phone: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) email: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) gstin: string | null;
  @ApiProperty() timezone: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: OrganizationStatus }) status: OrganizationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({ enum: MemberRole }) role: MemberRole;
}
