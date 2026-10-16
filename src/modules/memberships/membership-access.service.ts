import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AssignStoreMemberDto } from './dto/membership.dto';
import { TenantAccessService } from './tenant-access.service';

const assignmentSelect = {
  id: true,
  organizationId: true,
  storeId: true,
  userId: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreMemberSelect;
@Injectable()
export class MembershipAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TenantAccessService,
  ) {}
  listMembers(userId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.requireMember(tx, organizationId, userId, [
        'OWNER',
        'ADMIN',
      ]);
      return tx.organizationMember.findMany({
        where: {
          organizationId,
          organization: {
            status: { in: ['ONBOARDING', 'ACTIVE'] },
            members: {
              some: {
                userId,
                status: 'ACTIVE',
                role: { in: ['OWNER', 'ADMIN'] },
                user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
              },
            },
          },
        },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });
    });
  }
  assignStore(
    userId: string,
    organizationId: string,
    storeId: string,
    targetUserId: string,
    input: AssignStoreMemberDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lockOrganization(tx, organizationId);
      await this.access.requireMember(tx, organizationId, userId, [
        'OWNER',
        'ADMIN',
      ]);
      const store = await tx.store.findFirst({
        where: { id: storeId, organizationId },
        select: { id: true },
      });
      if (!store) throw new NotFoundException();
      const target = await tx.organizationMember.findFirst({
        where: {
          organizationId,
          userId: targetUserId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        },
        select: { id: true },
      });
      if (!target) throw new ForbiddenException();
      const previous = await tx.storeMember.findUnique({
        where: { storeId_userId: { storeId, userId: targetUserId } },
        select: assignmentSelect,
      });
      const status = input.status ?? 'ACTIVE';
      if (previous?.role === input.role && previous.status === status)
        return previous;
      const member = await tx.storeMember.upsert({
        where: { storeId_userId: { storeId, userId: targetUserId } },
        create: {
          organizationId,
          storeId,
          userId: targetUserId,
          role: input.role,
          status,
        },
        update: { role: input.role, status },
        select: assignmentSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'store_membership.changed',
          resourceType: 'StoreMember',
          resourceId: member.id,
          metadata: {
            role: input.role,
            status,
            previousRole: previous?.role ?? null,
            previousStatus: previous?.status ?? null,
          },
        },
      });
      return member;
    });
  }
}
