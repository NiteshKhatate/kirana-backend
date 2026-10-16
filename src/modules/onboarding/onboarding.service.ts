import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthClock } from '../auth/auth-clock.service';
import { TenantAccessService } from '../memberships/tenant-access.service';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TenantAccessService,
    private readonly clock: AuthClock,
  ) {}
  get(userId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.requireMember(tx, organizationId, userId);
      const progress = await tx.onboardingProgress.findFirst({
        where: {
          organizationId,
          organization: {
            status: { in: ['ONBOARDING', 'ACTIVE'] },
            members: {
              some: {
                userId,
                status: 'ACTIVE',
                user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
              },
            },
          },
        },
        select: {
          organizationId: true,
          currentStep: true,
          completedAt: true,
          updatedAt: true,
          organization: { select: { status: true } },
        },
      });
      if (!progress) throw new ConflictException();
      const { organization, ...state } = progress;
      return { ...state, organizationStatus: organization.status };
    });
  }
  complete(userId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lockOrganization(tx, organizationId);
      await this.access.requireMember(tx, organizationId, userId, [
        'OWNER',
        'ADMIN',
      ]);
      const owner = await tx.organizationMember.findFirst({
        where: {
          organizationId,
          role: 'OWNER',
          status: 'ACTIVE',
          user: { status: 'ACTIVE', emailVerifiedAt: { not: null } },
        },
        select: { id: true },
      });
      const store = await tx.store.findFirst({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      const progress = await tx.onboardingProgress.findUnique({
        where: { organizationId },
      });
      if (!owner || !store || !progress) throw new ConflictException();
      if (progress.completedAt)
        return { ...progress, organizationStatus: 'ACTIVE' as const };
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'ACTIVE' },
      });
      const completed = await tx.onboardingProgress.update({
        where: { organizationId },
        data: { currentStep: 'COMPLETE', completedAt: this.clock.now() },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'onboarding.completed',
          resourceType: 'Organization',
          resourceId: organizationId,
        },
      });
      return { ...completed, organizationStatus: 'ACTIVE' as const };
    });
  }
}
