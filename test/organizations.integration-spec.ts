import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { MembershipsService } from '../src/modules/memberships/memberships.service';
import { OrganizationsService } from '../src/modules/organizations/organizations.service';
import {
  MailAdapter,
  VerificationMail,
} from '../src/modules/email/mail.adapter';
import { testAccessToken } from './helpers/access-token';
import { connectTestDatabase } from './helpers/test-database';

interface OrganizationBody {
  id: string;
  slug: string;
  role: string;
  status: string;
}

describe('Organization ownership and isolation HTTP (dedicated PostgreSQL)', () => {
  let client: PrismaClient;
  let app: INestApplication<App>;
  let owner: string;
  let other: string;
  let slug: string;
  let ownerToken: string;
  let otherToken: string;
  const fixtureUsers = new Set<string>();
  const fixtureSlugs = new Set<string>();
  const messages: VerificationMail[] = [];
  const create = (token = ownerToken, values: object = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: ' My Shop ', slug, ...values });
  const details = (id: string, token = ownerToken) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${id}`)
      .set('Authorization', `Bearer ${token}`);
  const list = (token = ownerToken) =>
    request(app.getHttpServer())
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    client = await connectTestDatabase();
  });
  beforeEach(async () => {
    messages.length = 0;
    slug = `shop-${randomUUID()}`;
    fixtureSlugs.add(slug);
    for (const label of ['owner', 'other']) {
      const id = randomUUID();
      fixtureUsers.add(id);
      await client.user.create({
        data: {
          id,
          fullName: 'Tenant Test',
          email: `${id}@organizations.example.invalid`,
          passwordHash: 'unused-test-hash',
          emailVerifiedAt: new Date(),
        },
      });
      if (label === 'owner') owner = id;
      else other = id;
    }
    ownerToken = testAccessToken(owner, { role: 'MEMBER' });
    otherToken = testAccessToken(other, { role: 'OWNER' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailAdapter)
      .useValue({
        send: (message: VerificationMail) => {
          messages.push(message);
          return Promise.resolve('smtp-accepted');
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    // Remove only this suite's generated fixtures, in FK order, from verified test DB.
    const organizations = await client.organization.findMany({
      where: { slug: { in: [...fixtureSlugs] } },
      select: { id: true },
    });
    const ids = organizations.map((value) => value.id);
    await client.auditLog.deleteMany({
      where: { organizationId: { in: ids } },
    });
    await client.onboardingProgress.deleteMany({
      where: { organizationId: { in: ids } },
    });
    await client.storeMember.deleteMany({
      where: { organizationId: { in: ids } },
    });
    await client.store.deleteMany({ where: { organizationId: { in: ids } } });
    await client.organizationMember.deleteMany({
      where: { organizationId: { in: ids } },
    });
    await client.organization.deleteMany({ where: { id: { in: ids } } });
    await client.user.deleteMany({ where: { id: { in: [...fixtureUsers] } } });
    fixtureUsers.clear();
    fixtureSlugs.clear();
  });
  afterAll(async () => {
    await client?.$disconnect();
  });
  it('completes register → verify → login → organization → first store → onboarding over HTTP', async () => {
    const address = `${randomUUID()}@onboarding.example.invalid`;
    const password = 'a secure onboarding password';
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ fullName: 'New Owner', email: address, password })
      .expect(201);
    const { user } = registered.body as { user: { id: string } };
    fixtureUsers.add(user.id);
    const link = messages[0].text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('Missing fixture verification email');
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: new URL(link).searchParams.get('token') })
      .expect(200);
    const loggedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const { accessToken } = loggedIn.body as { accessToken: string };
    const organization = (await create(accessToken).expect(201))
      .body as OrganizationBody;
    expect(organization.role).toBe('OWNER');
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organization.id}/stores`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'MAIN', name: 'Main Store' })
      .expect(201);
    const completed = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organization.id}/onboarding/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(completed.body).toMatchObject({
      currentStep: 'COMPLETE',
      organizationStatus: 'ACTIVE',
    });
    await details(organization.id, accessToken).expect(200);
    await details(organization.id, ownerToken).expect(403);
  });
  it('atomically creates the tenant, owner, onboarding and audit; resumes identical submissions', async () => {
    const response = await create().expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const organization = response.body as OrganizationBody;
    expect(organization).toMatchObject({
      name: 'My Shop',
      slug,
      status: 'ONBOARDING',
      role: 'OWNER',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
    expect(
      await client.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: owner,
          },
        },
      }),
    ).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    expect(
      await client.onboardingProgress.findUnique({
        where: { organizationId: organization.id },
      }),
    ).toMatchObject({ currentStep: 'FIRST_STORE', completedAt: null });
    expect(
      await client.auditLog.count({
        where: {
          organizationId: organization.id,
          action: 'organization.created',
        },
      }),
    ).toBe(1);
    expect((await create().expect(201)).body).toEqual(response.body);
    expect(await client.organization.count({ where: { slug } })).toBe(1);
    await create(ownerToken, { name: 'Changed Shop' }).expect(409);
    await create(otherToken).expect(409);
  });
  it('serializes repeated parallel submissions into exactly one organization', async () => {
    const results = await Promise.all([create(), create(), create()]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(
      new Set(results.map((r) => (r.body as OrganizationBody).id)).size,
    ).toBe(1);
    expect(await client.organization.count({ where: { slug } })).toBe(1);
  });
  it('allows only one creator during cross-user slug contention', async () => {
    const results = await Promise.all([create(), create(otherToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await client.organization.count({ where: { slug } })).toBe(1);
  });
  it('rolls back organization, owner and onboarding when the audit write fails', async () => {
    const failingClient = client.$extends({
      query: {
        auditLog: {
          create: () => Promise.reject(new Error('test audit failure')),
        },
      },
    });
    const service = new OrganizationsService(
      failingClient as unknown as PrismaService,
    );
    await expect(
      service.create(owner, { name: 'My Shop', slug }),
    ).rejects.toThrow('test audit failure');
    expect(
      await client.organization.findUnique({ where: { slug } }),
    ).toBeNull();
    expect(
      await client.organizationMember.count({ where: { userId: owner } }),
    ).toBe(0);
    await create().expect(201);
  });
  it('isolates tenant A/B and ignores forged role/organization JWT claims', async () => {
    const a = (await create().expect(201)).body as OrganizationBody;
    const secondSlug = `other-${randomUUID()}`;
    fixtureSlugs.add(secondSlug);
    const b = (await create(otherToken, { slug: secondSlug }).expect(201))
      .body as OrganizationBody;
    expect((await list().expect(200)).body).toEqual([
      expect.objectContaining({ id: a.id }),
    ]);
    expect((await list(otherToken).expect(200)).body).toEqual([
      expect.objectContaining({ id: b.id }),
    ]);
    await details(a.id).expect(200);
    await details(
      a.id,
      testAccessToken(other, { role: 'OWNER', organizationId: a.id }),
    ).expect(403);
    await details(b.id).expect(403);
    await details(randomUUID()).expect(403);
  });
  it('enforces live member status, roles and organization suspension', async () => {
    const organization = (await create().expect(201)).body as OrganizationBody;
    await client.organizationMember.create({
      data: { organizationId: organization.id, userId: other, role: 'MEMBER' },
    });
    await details(organization.id, otherToken).expect(200);
    await client.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: other,
        },
      },
      data: { status: 'SUSPENDED' },
    });
    await details(organization.id, otherToken).expect(403);
    expect((await list(otherToken).expect(200)).body).toEqual([]);
    await client.organization.update({
      where: { id: organization.id },
      data: { status: 'SUSPENDED' },
    });
    await details(organization.id).expect(403);
    expect((await list().expect(200)).body).toEqual([]);
    await create().expect(409);
  });
  it('rejects unauthenticated, unverified, invalid and privilege-injecting submissions', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .send({ name: 'Shop', slug })
      .expect(401);
    await create(ownerToken, { role: 'OWNER' }).expect(400);
    await create(ownerToken, { status: 'ACTIVE' }).expect(400);
    await create(ownerToken, { name: ' ' }).expect(400);
    await create(ownerToken, { slug: 'bad/slug' }).expect(400);
    await create(ownerToken, { email: null }).expect(400);
    await client.user.update({
      where: { id: owner },
      data: { emailVerifiedAt: null },
    });
    await create().expect(401);
  });
  it('protects the last active OWNER under competing demotions and audits changes', async () => {
    const organization = (await create().expect(201)).body as OrganizationBody;
    await client.organizationMember.create({
      data: { organizationId: organization.id, userId: other, role: 'OWNER' },
    });
    const service = app.get(MembershipsService);
    const results = await Promise.allSettled([
      service.changeMember(organization.id, owner, owner, 'MEMBER', 'ACTIVE'),
      service.changeMember(organization.id, other, other, 'MEMBER', 'ACTIVE'),
    ]);
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await client.organizationMember.count({
        where: {
          organizationId: organization.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
    expect(
      await client.auditLog.count({
        where: {
          organizationId: organization.id,
          action: 'membership.changed',
        },
      }),
    ).toBe(1);
  });
});
