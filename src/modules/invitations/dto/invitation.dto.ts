import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { InvitationStatus, MemberRole, Prisma } from '@prisma/client';
import { ResendVerificationDto } from '../../auth/dto/resend-verification.dto';
import { VerifyEmailDto } from '../../auth/dto/verify-email.dto';

export class IssueInvitationDto extends ResendVerificationDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'MEMBER'], default: 'MEMBER' })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsIn(['ADMIN', 'MEMBER'])
  role?: 'ADMIN' | 'MEMBER';
}
export class AcceptInvitationDto extends VerifyEmailDto {}
export const publicInvitationSelect = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
} satisfies Prisma.InvitationSelect;
export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: MemberRole }) role: MemberRole;
  @ApiProperty({ enum: InvitationStatus }) status: InvitationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  acceptedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
export class IssueInvitationResponseDto {
  @ApiProperty({ type: InvitationResponseDto })
  invitation: InvitationResponseDto;
  @ApiProperty({ enum: ['development-outbox', 'smtp-accepted', 'failed'] })
  emailDelivery: string;
}
