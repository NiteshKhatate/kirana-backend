import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole, MemberStatus, StoreRole } from '@prisma/client';
import { IsEnum, IsIn, ValidateIf } from 'class-validator';

export class AssignStoreMemberDto {
  @ApiProperty({ enum: StoreRole })
  @IsEnum(StoreRole)
  role: StoreRole;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}
export class MembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ enum: MemberRole }) role: MemberRole;
  @ApiProperty({ enum: MemberStatus }) status: MemberStatus;
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt: Date;
}
class MemberUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
  @ApiProperty() email: string;
}
export class MemberListResponseDto extends MembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: MemberUserDto }) user: MemberUserDto;
}
export class StoreAssignmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty({ format: 'uuid' }) storeId: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ enum: StoreRole }) role: StoreRole;
  @ApiProperty({ enum: MemberStatus }) status: MemberStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
