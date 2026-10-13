import { Prisma } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export const publicUserSelect = {
  id: true,
  fullName: true,
  email: true,
  emailVerifiedAt: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export class PublicUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  fullName: string;
  @ApiProperty({ format: 'email' })
  email: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt: Date | null;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'DISABLED'] })
  status: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
