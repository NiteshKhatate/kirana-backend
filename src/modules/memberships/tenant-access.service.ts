import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole, Prisma, StoreRole } from '@prisma/client';
import { publicStoreSelect } from '../stores/dto/store-response.dto';

@Injectable()
export class TenantAccessService {
  async lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
    // Shared by all tenant mutations, including MembershipsService.changeMember.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  }

  async requireMember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    roles: MemberRole[] = ['OWNER', 'ADMIN', 'MEMBER'],
  ) {
    const member = await tx.organizationMember.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        role: { in: roles },
        user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
      },
      select: { role: true },
    });
    if (!member) throw new ForbiddenException();
    return member;
  }

  async requireStore(
    tx: Prisma.TransactionClient,
    organizationId: string,
    storeId: string,
    userId: string,
    roles: StoreRole[] = ['MANAGER', 'CASHIER', 'INVENTORY'],
  ) {
    const member = await this.requireMember(tx, organizationId, userId);
    const store = await tx.store.findFirst({
      where: {
        id: storeId,
        organizationId,
        organization: {
          status: { in: ['ONBOARDING', 'ACTIVE'] },
          members: {
            some: {
              userId,
              status: 'ACTIVE',
              role: member.role,
              user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
            },
          },
        },
        ...(member.role === 'MEMBER'
          ? {
              status: 'ACTIVE' as const,
              members: {
                some: {
                  organizationId,
                  userId,
                  status: 'ACTIVE' as const,
                  role: { in: roles },
                },
              },
            }
          : {}),
      },
      select: publicStoreSelect,
    });
    if (!store) throw new NotFoundException();
    return store;
  }
}
