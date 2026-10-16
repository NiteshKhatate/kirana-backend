import { Module } from '@nestjs/common';
import { OrganizationRoleGuard } from './organization-role.guard';
import { MembershipsService } from './memberships.service';

@Module({
  providers: [OrganizationRoleGuard, MembershipsService],
  exports: [OrganizationRoleGuard, MembershipsService],
})
export class MembershipsModule {}
