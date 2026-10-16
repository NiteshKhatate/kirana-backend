import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, MemberRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { AuthClock } from '../../src/modules/auth/auth-clock.service';
import {
  MailAdapter,
  VerificationMail,
} from '../../src/modules/email/mail.adapter';
import { testAccessToken } from './access-token';

/** Call only with connectTestDatabase()'s verified dedicated client. */
export class TenantFixture {
  readonly users = new Set<string>();
  readonly organizations = new Set<string>();
  readonly messages: VerificationMail[] = [];
  now = Date.now();
  readonly send = jest.fn((message: VerificationMail) => {
    this.messages.push(message);
    return Promise.resolve('smtp-accepted');
  });
  constructor(readonly client: PrismaClient) {}
  async app(): Promise<INestApplication<App>> {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthClock)
      .useValue({ now: () => new Date(this.now) })
      .overrideProvider(MailAdapter)
      .useValue({ send: this.send })
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    return app;
  }
  async user() {
    const id = randomUUID();
    this.users.add(id);
    const user = await this.client.user.create({
      data: {
        id,
        fullName: 'Fixture User',
        email: `${id}@tenant-fixture.example.invalid`,
        passwordHash: 'unused-test-hash',
        emailVerifiedAt: new Date(this.now),
      },
    });
    return {
      ...user,
      token: testAccessToken(id, {
        iat: Math.floor(this.now / 1000),
        exp: Math.floor(this.now / 1000) + 900,
      }),
    };
  }
  async organization(ownerId: string) {
    const id = randomUUID();
    this.organizations.add(id);
    return this.client.organization.create({
      data: {
        id,
        name: 'Fixture Organization',
        slug: `fixture-${id}`,
        members: { create: { userId: ownerId, role: 'OWNER' } },
        onboarding: { create: {} },
      },
    });
  }
  async member(
    organizationId: string,
    userId: string,
    role: MemberRole = 'MEMBER',
  ) {
    return this.client.organizationMember.create({
      data: { organizationId, userId, role },
    });
  }
  async cleanup() {
    const where = { organizationId: { in: [...this.organizations] } };
    await this.client.auditLog.deleteMany({ where });
    await this.client.invitation.deleteMany({ where });
    await this.client.storeMember.deleteMany({ where });
    await this.client.store.deleteMany({ where });
    await this.client.onboardingProgress.deleteMany({ where });
    await this.client.organizationMember.deleteMany({ where });
    await this.client.organization.deleteMany({
      where: { id: { in: [...this.organizations] } },
    });
    await this.client.user.deleteMany({
      where: { id: { in: [...this.users] } },
    });
  }
}
