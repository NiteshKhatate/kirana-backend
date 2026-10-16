import { Module } from '@nestjs/common';
import { OrganizationRoleGuard } from './organization-role.guard';
import { MembershipsService } from './memberships.service';
import { TenantAccessService } from './tenant-access.service';
import { AuthModule } from '../auth/auth.module';
import { MembershipAccessService } from './membership-access.service';
import { MembershipsController } from './memberships.controller';
import { StoreRoleGuard } from './store-role.guard';

@Module({
  imports: [AuthModule],
  controllers: [MembershipsController],
  providers: [
    OrganizationRoleGuard,
    MembershipsService,
    TenantAccessService,
    MembershipAccessService,
    StoreRoleGuard,
  ],
  exports: [
    OrganizationRoleGuard,
    MembershipsService,
    TenantAccessService,
    StoreRoleGuard,
  ],
})
export class MembershipsModule {}
