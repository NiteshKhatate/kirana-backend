import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/access-token.guard';
import { TenantAccessService } from './tenant-access.service';

const STORE_ROLES = 'kirana.store.roles';
export const StoreRoles = (...roles: StoreRole[]) =>
  SetMetadata(STORE_ROLES, roles);
@Injectable()
export class StoreRoleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TenantAccessService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { orgId, storeId } = request.params;
    if (
      !request.user ||
      typeof orgId !== 'string' ||
      typeof storeId !== 'string' ||
      !isUUID(orgId) ||
      !isUUID(storeId)
    )
      throw new ForbiddenException();
    const roles =
      this.reflector.getAllAndOverride<StoreRole[]>(STORE_ROLES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? Object.values(StoreRole);
    const userId = request.user.id;
    await this.prisma.$transaction((tx) =>
      this.access.requireStore(tx, orgId, storeId, userId, roles),
    );
    return true;
  }
}
