import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantAccessService } from '../memberships/tenant-access.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { publicStoreSelect } from './dto/store-response.dto';

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TenantAccessService,
  ) {}
  async create(userId: string, organizationId: string, input: CreateStoreDto) {
    const data = {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      phone: input.phone?.trim() ?? null,
      addressLine1: input.addressLine1?.trim() ?? null,
      addressLine2: input.addressLine2?.trim() ?? null,
      city: input.city?.trim() ?? null,
      state: input.state?.trim() ?? null,
      postalCode: input.postalCode?.trim() ?? null,
      country: input.country?.trim().toUpperCase() ?? 'IN',
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.access.lockOrganization(tx, organizationId);
        await this.access.requireMember(tx, organizationId, userId, [
          'OWNER',
          'ADMIN',
        ]);
        const existing = await tx.store.findUnique({
          where: { organizationId_code: { organizationId, code: data.code } },
          select: publicStoreSelect,
        });
        if (existing) {
          if (
            Object.entries(data).some(
              ([key, value]) => existing[key as keyof typeof data] !== value,
            )
          )
            throw new ConflictException();
          return existing;
        }
        const store = await tx.store.create({
          data: { ...data, organizationId },
          select: publicStoreSelect,
        });
        await tx.onboardingProgress.updateMany({
          where: {
            organizationId,
            currentStep: 'FIRST_STORE',
            completedAt: null,
          },
          data: { currentStep: 'REVIEW' },
        });
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            action: 'store.created',
            resourceType: 'Store',
            resourceId: store.id,
          },
        });
        return store;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException();
      throw error;
    }
  }
  list(userId: string, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await this.access.requireMember(
        tx,
        organizationId,
        userId,
      );
      return tx.store.findMany({
        where: {
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
                  some: { userId, organizationId, status: 'ACTIVE' as const },
                },
              }
            : {}),
        },
        select: publicStoreSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  }
  get(userId: string, organizationId: string, storeId: string) {
    return this.prisma.$transaction((tx) =>
      this.access.requireStore(tx, organizationId, storeId, userId),
    );
  }
}
