import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { TenantAccessService } from '../src/modules/memberships/tenant-access.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { connectTestDatabase } from './helpers/test-database';
import { TenantFixture } from './helpers/tenant-fixture';

describe('Stores and onboarding HTTP (dedicated PostgreSQL)', () => {
  let client: PrismaClient;
  let fixture: TenantFixture;
  let app: INestApplication<App>;
  let owner: Awaited<ReturnType<TenantFixture['user']>>;
  let staff: typeof owner;
  let orgId: string;
  const postStore = (
    token = owner.token,
    input: object = {},
    organizationId = orgId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/stores`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: ' main ', name: ' Main Shop ', ...input });
  const complete = (token = owner.token) =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgId}/onboarding/complete`)
      .set('Authorization', `Bearer ${token}`);
  const progress = () =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}/onboarding`)
      .set('Authorization', `Bearer ${owner.token}`);
  const list = (token = owner.token, organizationId = orgId) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/stores`)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    client = await connectTestDatabase();
  });
  beforeEach(async () => {
    fixture = new TenantFixture(client);
    owner = await fixture.user();
    staff = await fixture.user();
    orgId = (await fixture.organization(owner.id)).id;
    app = await fixture.app();
  });
  afterEach(async () => {
    await app?.close();
    await fixture?.cleanup();
  });
  afterAll(async () => {
    await client?.$disconnect();
  });
  it('creates the first store and advances progress atomically, resumes and completes once', async () => {
    expect((await progress().expect(200)).body).toMatchObject({
      currentStep: 'FIRST_STORE',
      completedAt: null,
      organizationStatus: 'ONBOARDING',
    });
    const response = await postStore().expect(201);
    expect(response.body).toMatchObject({
      organizationId: orgId,
      code: 'MAIN',
      name: 'Main Shop',
      country: 'IN',
      status: 'ACTIVE',
    });
    expect((await progress().expect(200)).body).toMatchObject({
      currentStep: 'REVIEW',
      completedAt: null,
    });
    expect((await postStore().expect(201)).body).toEqual(response.body);
    const results = await Promise.all([complete(), complete()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    expect(results[0].body).toMatchObject({
      currentStep: 'COMPLETE',
      organizationStatus: 'ACTIVE',
      completedAt: new Date(fixture.now).toISOString(),
    });
    expect(
      await client.auditLog.count({
        where: { organizationId: orgId, action: 'onboarding.completed' },
      }),
    ).toBe(1);
    await postStore(owner.token, { code: 'BRANCH' }).expect(201);
    expect((await progress().expect(200)).body).toMatchObject({
      currentStep: 'COMPLETE',
    });
  });
  it('rejects completion without a store, an active store, or an eligible owner', async () => {
    await complete().expect(409);
    await postStore().expect(201);
    await client.store.updateMany({
      where: { organizationId: orgId },
      data: { status: 'INACTIVE' },
    });
    await complete().expect(409);
    await client.store.updateMany({
      where: { organizationId: orgId },
      data: { status: 'ACTIVE' },
    });
    await fixture.member(orgId, staff.id, 'ADMIN');
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: owner.id },
      data: { status: 'SUSPENDED' },
    });
    await complete(staff.token).expect(409);
    expect(
      (await client.organization.findUniqueOrThrow({ where: { id: orgId } }))
        .status,
    ).toBe('ONBOARDING');
  });
  it('serializes duplicate codes, conflicts on changed payload, and scopes uniqueness by organization', async () => {
    const results = await Promise.all([postStore(), postStore()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    await postStore(owner.token, { name: 'Changed' }).expect(409);
    const otherOrg = await fixture.organization(staff.id);
    await postStore(staff.token, {}, otherOrg.id).expect(201);
    expect(await client.store.count({ where: { organizationId: orgId } })).toBe(
      1,
    );
  });
  it('restricts store creation and onboarding completion to current OWNER/ADMIN roles', async () => {
    await fixture.member(orgId, staff.id);
    await postStore(staff.token).expect(403);
    await complete(staff.token).expect(403);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { role: 'ADMIN' },
    });
    await postStore(staff.token).expect(201);
    await complete(staff.token).expect(200);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { status: 'SUSPENDED' },
    });
    await postStore(staff.token, { code: 'OTHER' }).expect(403);
  });
  it('requires explicit store assignment for staff and blocks cross-org store injection', async () => {
    await fixture.member(orgId, staff.id);
    const first = (await postStore().expect(201)).body as { id: string };
    const second = (
      await postStore(owner.token, { code: 'SECOND' }).expect(201)
    ).body as { id: string };
    expect((await list(staff.token).expect(200)).body).toEqual([]);
    await client.storeMember.create({
      data: {
        organizationId: orgId,
        storeId: first.id,
        userId: staff.id,
        role: 'CASHIER',
      },
    });
    expect((await list(staff.token).expect(200)).body).toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
    const get = (storeId: string, organizationId = orgId) =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/stores/${storeId}`)
        .set('Authorization', `Bearer ${staff.token}`);
    await get(first.id).expect(200);
    await get(second.id).expect(404);
    const otherOrg = await fixture.organization(staff.id);
    await get(first.id, otherOrg.id).expect(404);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { status: 'SUSPENDED' },
    });
    await get(first.id).expect(403);
    await list(staff.token).expect(403);
    expect((await list().expect(200)).body).toHaveLength(2);
  });
  it('rejects unrelated users, parent injection and invalid location/contact DTOs', async () => {
    await postStore(staff.token).expect(403);
    await list(staff.token).expect(403);
    for (const input of [
      { organizationId: orgId },
      { status: 'INACTIVE' },
      { name: ' ' },
      { country: 'ZZ' },
      { phone: 'bad' },
      { city: null },
      { code: 'invalid/code' },
    ])
      await postStore(owner.token, input).expect(400);
    await client.organization.update({
      where: { id: orgId },
      data: { status: 'SUSPENDED' },
    });
    await postStore().expect(403);
    await progress().expect(403);
    await complete().expect(403);
  });
  it('rolls back store/progress and completion when audit persistence fails', async () => {
    const failing = client.$extends({
      query: {
        auditLog: { create: () => Promise.reject(new Error('audit failure')) },
      },
    });
    const access = new TenantAccessService();
    await expect(
      new StoresService(failing as unknown as PrismaService, access).create(
        owner.id,
        orgId,
        { code: 'MAIN', name: 'Shop' },
      ),
    ).rejects.toThrow('audit failure');
    expect(await client.store.count({ where: { organizationId: orgId } })).toBe(
      0,
    );
    expect((await progress().expect(200)).body).toMatchObject({
      currentStep: 'FIRST_STORE',
    });
    await postStore().expect(201);
    await expect(
      new OnboardingService(failing as unknown as PrismaService, access, {
        now: () => new Date(fixture.now),
      }).complete(owner.id, orgId),
    ).rejects.toThrow('audit failure');
    expect((await progress().expect(200)).body).toMatchObject({
      currentStep: 'REVIEW',
      completedAt: null,
      organizationStatus: 'ONBOARDING',
    });
  });
});
