import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/access-token.guard';

const ORGANIZATION_ROLES = 'kirana.organization.roles';
export const OrganizationRoles = (...roles: MemberRole[]) =>
  SetMetadata(ORGANIZATION_ROLES, roles);

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = request.params.orgId;
    if (!request.user || typeof orgId !== 'string' || !isUUID(orgId))
      throw new ForbiddenException();
    const roles =
      this.reflector.getAllAndOverride<MemberRole[]>(ORGANIZATION_ROLES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? Object.values(MemberRole);
    const member = await this.prisma.organizationMember.findFirst({
      where: {
        organizationId: orgId,
        userId: request.user.id,
        status: 'ACTIVE',
        organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
      },
      select: { role: true },
    });
    if (!member || !roles.includes(member.role)) throw new ForbiddenException();
    return true;
  }
}
