import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, MemberStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Future membership endpoints must use this transaction boundary for changes. */
@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}
  async changeMember(
    organizationId: string,
    actorUserId: string,
    userId: string,
    role: MemberRole,
    status: MemberStatus,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // All membership mutations serialize on the organization, including owner checks.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const actor = await tx.organizationMember.findFirst({
        where: {
          organizationId,
          userId: actorUserId,
          status: 'ACTIVE',
          role: 'OWNER',
          user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
          organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
        },
      });
      if (!actor) throw new ForbiddenException();
      const target = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      if (!target) throw new NotFoundException();
      if (
        target.role === 'OWNER' &&
        target.status === 'ACTIVE' &&
        (role !== 'OWNER' || status !== 'ACTIVE')
      ) {
        const owners = await tx.organizationMember.count({
          where: { organizationId, role: 'OWNER', status: 'ACTIVE' },
        });
        if (owners <= 1) throw new ConflictException();
      }
      const member = await tx.organizationMember.update({
        where: { id: target.id },
        data: { role, status },
        select: {
          userId: true,
          organizationId: true,
          role: true,
          status: true,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: 'membership.changed',
          resourceType: 'OrganizationMember',
          resourceId: target.id,
          metadata: {
            previousRole: target.role,
            previousStatus: target.status,
            role,
            status,
          },
        },
      });
      return member;
    });
  }
}
