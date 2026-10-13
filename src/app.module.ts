import { appConfigOptions } from './config/load-environment';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { StoresModule } from './modules/stores/stores.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot(appConfigOptions),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    StoresModule,
    MembershipsModule,
    OnboardingModule,
    InvitationsModule,
    AuditModule,
  ],
})
export class AppModule {}
