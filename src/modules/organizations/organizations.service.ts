import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { publicOrganizationSelect } from './dto/organization-response.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(userId: string, input: CreateOrganizationDto) {
    const data = {
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      businessType: input.businessType?.trim() ?? null,
      phone: input.phone?.trim() ?? null,
      email: input.email?.trim().toLowerCase() ?? null,
      gstin: input.gstin?.trim().toUpperCase() ?? null,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findFirst({
          where: {
            id: userId,
            status: 'ACTIVE',
            emailVerifiedAt: { not: null },
          },
          select: { id: true },
        });
        if (!user) throw new UnauthorizedException();
        // Stable slug is the retry identity. Advisory hash collisions only serialize
        // unrelated slugs; the unique index remains the final conflict arbiter.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${data.slug})::bigint)::text`;
        const existing = await tx.organization.findUnique({
          where: { slug: data.slug },
          select: publicOrganizationSelect,
        });
        if (existing) {
          const original = await tx.auditLog.findFirst({
            where: {
              organizationId: existing.id,
              actorUserId: userId,
              action: 'organization.created',
              metadata: { path: ['requestFingerprint'], equals: fingerprint },
            },
          });
          const owner = await tx.organizationMember.findFirst({
            where: {
              organizationId: existing.id,
              userId,
              role: 'OWNER',
              status: 'ACTIVE',
            },
          });
          if (
            !original ||
            !owner ||
            !['ACTIVE', 'ONBOARDING'].includes(existing.status)
          )
            throw new ConflictException();
          return { ...existing, role: owner.role };
        }
        const organization = await tx.organization.create({
          data: {
            ...data,
            status: 'ONBOARDING',
            members: { create: { userId, role: 'OWNER', status: 'ACTIVE' } },
            onboarding: { create: { currentStep: 'FIRST_STORE' } },
          },
          select: publicOrganizationSelect,
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            actorUserId: userId,
            action: 'organization.created',
            resourceType: 'Organization',
            resourceId: organization.id,
            metadata: { requestFingerprint: fingerprint },
          },
        });
        return { ...organization, role: 'OWNER' as const };
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
  async list(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
      },
      select: {
        role: true,
        organization: { select: publicOrganizationSelect },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return memberships.map(({ organization, role }) => ({
      ...organization,
      role,
    }));
  }
  async get(userId: string, organizationId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
      },
      select: {
        role: true,
        organization: { select: publicOrganizationSelect },
      },
    });
    if (!membership) throw new NotFoundException();
    return { ...membership.organization, role: membership.role };
  }
}
