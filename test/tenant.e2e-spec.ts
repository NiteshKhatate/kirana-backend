import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../src/modules/auth/access-token.guard';
import { AuthClock } from '../src/modules/auth/auth-clock.service';
import { OrganizationRoleGuard } from '../src/modules/memberships/organization-role.guard';
import { StoreRoleGuard } from '../src/modules/memberships/store-role.guard';
import { MembershipAccessService } from '../src/modules/memberships/membership-access.service';
import { InvitationsService } from '../src/modules/invitations/invitations.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';

/** Only this boundary suite overrides authorization; isolation is tested with real guards/DB separately. */
describe('Store and staff HTTP contracts (services mocked)', () => {
  const orgId = '1c77f744-7363-4005-b644-a4a2e65c740d',
    storeId = '1c77f744-7363-4005-b644-a4a2e65c740e',
    userId = '1c77f744-7363-4005-b644-a4a2e65c740f';
  const base = `/api/v1/organizations/${orgId}`;
  const stores = { create: jest.fn(), list: jest.fn(), get: jest.fn() },
    onboarding = { get: jest.fn(), complete: jest.fn() };
  const invitations = {
      issue: jest.fn(),
      revoke: jest.fn(),
      accept: jest.fn(),
    },
    membership = { listMembers: jest.fn(), assignStore: jest.fn() };
  let app: INestApplication<App>;
  let now: number;
  beforeEach(async () => {
    jest.resetAllMocks();
    now = Date.now();
    stores.create.mockResolvedValue({ id: storeId });
    invitations.issue.mockResolvedValue({
      invitation: { id: storeId },
      emailDelivery: 'smtp-accepted',
    });
    invitations.accept.mockResolvedValue({
      organizationId: orgId,
      userId,
      status: 'ACTIVE',
    });
    membership.assignStore.mockResolvedValue({ storeId, userId });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(StoresService)
      .useValue(stores)
      .overrideProvider(OnboardingService)
      .useValue(onboarding)
      .overrideProvider(InvitationsService)
      .useValue(invitations)
      .overrideProvider(MembershipAccessService)
      .useValue(membership)
      .overrideProvider(AuthClock)
      .useValue({ now: () => new Date(now) })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<AuthenticatedRequest>().user = {
            id: userId,
          } as AuthenticatedRequest['user'];
          return true;
        },
      })
      .overrideGuard(OrganizationRoleGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(StoreRoleGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });
  it('normalizes store data and returns no-store responses', async () => {
    const response = await request(app.getHttpServer())
      .post(`${base}/stores`)
      .send({
        code: ' main ',
        name: ' Main Shop ',
        country: ' in ',
        city: ' Pune ',
      })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(stores.create).toHaveBeenCalledWith(userId, orgId, {
      code: 'MAIN',
      name: 'Main Shop',
      country: 'IN',
      city: 'Pune',
    });
    await request(app.getHttpServer()).get(`${base}/stores`).expect(200);
    await request(app.getHttpServer())
      .get(`${base}/stores/${storeId}`)
      .expect(200);
    await request(app.getHttpServer()).get(`${base}/onboarding`).expect(200);
    await request(app.getHttpServer())
      .post(`${base}/onboarding/complete`)
      .expect(200);
  });
  it.each([
    { organizationId: orgId },
    { role: 'OWNER' },
    { code: 'bad/code' },
    { country: 'ZZ' },
    { postalCode: 'bad@code' },
    { phone: null },
    { name: ' ' },
  ])('rejects invalid/privilege-injecting store DTO %p', async (input) => {
    await request(app.getHttpServer())
      .post(`${base}/stores`)
      .send({ code: 'MAIN', name: 'Shop', ...input })
      .expect(400);
    expect(stores.create).not.toHaveBeenCalled();
  });
  it('normalizes invitation email and documents safe invitation responses', async () => {
    await request(app.getHttpServer())
      .post(`${base}/invitations`)
      .send({ email: ' STAFF@Example.com ', role: 'MEMBER' })
      .expect(201);
    expect(invitations.issue).toHaveBeenCalledWith(userId, orgId, {
      email: 'staff@example.com',
      role: 'MEMBER',
    });
    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .send({ token: 'a'.repeat(64) })
      .expect(200);
    expect(invitations.accept).toHaveBeenCalledWith(userId, 'a'.repeat(64));
    await request(app.getHttpServer())
      .post(`${base}/invitations/${storeId}/revoke`)
      .expect(200);
  });
  it.each([
    { email: 'invalid' },
    { email: 'staff@example.com', role: 'OWNER' },
    { email: 'staff@example.com', storeId },
    { email: 'staff@example.com', role: null },
  ])('rejects invalid invitations %p', async (input) => {
    await request(app.getHttpServer())
      .post(`${base}/invitations`)
      .send(input)
      .expect(400);
    expect(invitations.issue).not.toHaveBeenCalled();
  });
  it('accepts codes only in JSON bodies and rejects malformed/extra acceptance fields', async () => {
    for (const input of [
      { token: 'bad' },
      { token: 'a'.repeat(64), organizationId: orgId },
      {},
    ])
      await request(app.getHttpServer())
        .post('/api/v1/invitations/accept')
        .send(input)
        .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/accept?token=${'a'.repeat(64)}`)
      .send({})
      .expect(400);
    expect(invitations.accept).not.toHaveBeenCalled();
  });
  it('validates store assignment roles/status/scope and lists safe members', async () => {
    const path = `${base}/stores/${storeId}/members/${userId}`;
    await request(app.getHttpServer())
      .put(path)
      .send({ role: 'MANAGER', status: 'SUSPENDED' })
      .expect(200);
    expect(membership.assignStore).toHaveBeenCalledWith(
      userId,
      orgId,
      storeId,
      userId,
      { role: 'MANAGER', status: 'SUSPENDED' },
    );
    membership.assignStore.mockClear();
    for (const input of [
      { role: 'OWNER' },
      { role: 'CASHIER', status: 'INVITED' },
      { role: 'CASHIER', organizationId: orgId },
      { role: 'CASHIER', status: null },
    ])
      await request(app.getHttpServer()).put(path).send(input).expect(400);
    await request(app.getHttpServer())
      .put(`${base}/stores/invalid/members/${userId}`)
      .send({ role: 'CASHIER' })
      .expect(400);
    expect(membership.assignStore).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`${base}/members`).expect(200);
    expect(membership.listMembers).toHaveBeenCalledWith(userId, orgId);
  });
  it('rate limits invitation issuance and acceptance before business logic', async () => {
    const issue = () =>
      request(app.getHttpServer())
        .post(`${base}/invitations`)
        .send({ email: 'staff@example.com' });
    for (let i = 0; i < 10; i++) await issue().expect(201);
    await issue().expect(429);
    expect(invitations.issue).toHaveBeenCalledTimes(10);
    const accept = () =>
      request(app.getHttpServer())
        .post('/api/v1/invitations/accept')
        .send({ token: 'a'.repeat(64) });
    for (let i = 0; i < 30; i++) await accept().expect(200);
    await accept().expect(429);
    expect(invitations.accept).toHaveBeenCalledTimes(30);
    now += 60000;
    await issue().expect(201);
    await accept().expect(200);
  });
  it('documents all implemented store, onboarding and staff endpoints', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as { paths: Record<string, unknown> };
    for (const path of [
      '/organizations/{orgId}/stores',
      '/organizations/{orgId}/stores/{storeId}',
      '/organizations/{orgId}/onboarding',
      '/organizations/{orgId}/onboarding/complete',
      '/organizations/{orgId}/invitations',
      '/organizations/{orgId}/invitations/{invitationId}/revoke',
      '/invitations/accept',
      '/organizations/{orgId}/members',
      '/organizations/{orgId}/stores/{storeId}/members/{userId}',
    ])
      expect(document.paths).toHaveProperty(`/api/v1${path}`);
  });
});
