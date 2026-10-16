import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { AuthClock } from '../src/modules/auth/auth-clock.service';
import { VerificationTokenService } from '../src/modules/auth/verification-token.service';
import { SecurityEvents } from '../src/modules/audit/security-events.service';
import { EmailService } from '../src/modules/email/email.service';
import { InvitationsService } from '../src/modules/invitations/invitations.service';
import { MembershipAccessService } from '../src/modules/memberships/membership-access.service';
import { TenantAccessService } from '../src/modules/memberships/tenant-access.service';
import { connectTestDatabase } from './helpers/test-database';
import { TenantFixture } from './helpers/tenant-fixture';

describe('Invitations and staff authorization HTTP (dedicated PostgreSQL)', () => {
  let client: PrismaClient;
  let fixture: TenantFixture;
  let app: INestApplication<App>;
  let owner: Awaited<ReturnType<TenantFixture['user']>>;
  let admin: typeof owner;
  let staff: typeof owner;
  let orgId: string;
  let storeId: string;
  const issue = (
    token = owner.token,
    body: object = {},
    organizationId = orgId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: staff.email, ...body });
  const accept = (code: string, token = staff.token) =>
    request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: code });
  const revoke = (id: string, token = owner.token, organizationId = orgId) =>
    request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/invitations/${id}/revoke`)
      .set('Authorization', `Bearer ${token}`);
  const assign = (
    input: object = {},
    target = staff.id,
    store = storeId,
    organizationId = orgId,
    token = owner.token,
  ) =>
    request(app.getHttpServer())
      .put(
        `/api/v1/organizations/${organizationId}/stores/${store}/members/${target}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'CASHIER', ...input });
  const stores = (token = staff.token) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}/stores`)
      .set('Authorization', `Bearer ${token}`);
  const detail = (token = staff.token) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}/stores/${storeId}`)
      .set('Authorization', `Bearer ${token}`);
  const members = (token = owner.token) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`);
  const code = () => {
    const value = fixture.messages.at(-1)?.text.match(/\b[a-f0-9]{64}\b/)?.[0];
    if (!value) throw new Error('Missing test invitation code');
    return value;
  };
  beforeAll(async () => {
    client = await connectTestDatabase();
  });
  beforeEach(async () => {
    fixture = new TenantFixture(client);
    owner = await fixture.user();
    admin = await fixture.user();
    staff = await fixture.user();
    orgId = (await fixture.organization(owner.id)).id;
    await fixture.member(orgId, admin.id, 'ADMIN');
    storeId = (
      await client.store.create({
        data: { organizationId: orgId, code: 'MAIN', name: 'Main' },
      })
    ).id;
    app = await fixture.app();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await fixture?.cleanup();
  });
  afterAll(async () => {
    await client?.$disconnect();
  });
  it('lets an invited new account register, verify, log in, accept and receive store access', async () => {
    const address = `new-${staff.id}@tenant-fixture.example.invalid`,
      password = 'a secure new staff password';
    await issue(owner.token, { email: address }).expect(201);
    const invitationCode = code();
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ fullName: 'New Staff', email: address, password })
      .expect(201);
    const { user } = registered.body as { user: { id: string } };
    fixture.users.add(user.id);
    const link = fixture.messages.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error('Missing verification link');
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: new URL(link).searchParams.get('token') })
      .expect(200);
    const loggedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const { accessToken } = loggedIn.body as { accessToken: string };
    await accept(invitationCode, accessToken).expect(200);
    await assign({ role: 'INVENTORY' }, user.id).expect(200);
    await detail(accessToken).expect(200);
  });
  it('issues hashed invitations, accepts matching verified email, and grants only explicit store access', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const response = await issue(owner.token, {
      email: ` ${staff.email.toUpperCase()} `,
    }).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const invitation = (response.body as { invitation: { id: string } })
      .invitation;
    const raw = code();
    const stored = await client.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenHash).toBe(new VerificationTokenService().hash(raw));
    expect(stored.tokenHash).not.toBe(raw);
    expect(JSON.stringify(response.body)).not.toMatch(
      /tokenHash|token|password/i,
    );
    expect(fixture.messages[0].text).not.toContain('?token=');
    await accept(raw)
      .expect(200)
      .expect((r) => {
        expect(r.body).toMatchObject({
          userId: staff.id,
          organizationId: orgId,
          role: 'MEMBER',
          status: 'ACTIVE',
        });
      });
    expect((await stores().expect(200)).body).toEqual([]);
    await detail().expect(404);
    await assign().expect(200);
    await detail().expect(200);
    expect((await stores().expect(200)).body).toEqual([
      expect.objectContaining({ id: storeId }),
    ]);
    const body: unknown = (await members().expect(200)).body;
    expect(JSON.stringify(body)).not.toMatch(
      /password|token|phone|emailVerifiedAt/i,
    );
    await members(admin.token).expect(200);
    await members(staff.token).expect(403);
    expect(JSON.stringify(log.mock.calls)).not.toContain(raw);
    await accept(raw).expect(409);
    expect(
      await client.auditLog.count({
        where: { organizationId: orgId, action: 'invitation.accepted' },
      }),
    ).toBe(1);
  });
  it('rejects wrong email, unverified/inactive accounts, missing codes and expiry', async () => {
    const response = await issue().expect(201);
    const raw = code();
    await accept(raw, admin.token).expect(400);
    await accept('f'.repeat(64)).expect(400);
    await client.user.update({
      where: { id: staff.id },
      data: { emailVerifiedAt: null },
    });
    await accept(raw).expect(401);
    await client.user.update({
      where: { id: staff.id },
      data: { emailVerifiedAt: new Date(fixture.now), status: 'DISABLED' },
    });
    await accept(raw).expect(401);
    await client.user.update({
      where: { id: staff.id },
      data: { status: 'ACTIVE' },
    });
    const { invitation } = response.body as { invitation: { id: string } };
    await client.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(fixture.now) },
    });
    await accept(raw).expect(400);
    expect(
      await client.organizationMember.count({
        where: { organizationId: orgId, userId: staff.id },
      }),
    ).toBe(0);
  });
  it('revokes idempotently, scopes revocation to the organization and invalidates the code', async () => {
    const { invitation } = (await issue().expect(201)).body as {
      invitation: { id: string };
    };
    const raw = code();
    const other = await fixture.organization(owner.id);
    await revoke(invitation.id, owner.token, other.id).expect(404);
    await revoke(invitation.id).expect(200);
    await revoke(invitation.id).expect(200);
    await accept(raw).expect(400);
    expect(
      await client.auditLog.count({
        where: { organizationId: orgId, action: 'invitation.revoked' },
      }),
    ).toBe(1);
  });
  it('enforces role ceilings and does not let ADMIN reissue/revoke an ADMIN invitation', async () => {
    await issue(staff.token).expect(403);
    await issue(admin.token, { role: 'ADMIN' }).expect(403);
    await issue(owner.token, { role: 'OWNER' }).expect(400);
    const { invitation } = (
      await issue(owner.token, { role: 'ADMIN' }).expect(201)
    ).body as { invitation: { id: string } };
    const raw = code();
    await revoke(invitation.id, admin.token).expect(403);
    fixture.now += 61000;
    await issue(admin.token).expect(403);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: owner.id },
      data: { role: 'ADMIN' },
    });
    await accept(raw).expect(403);
    expect(
      (
        await client.invitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).status,
    ).toBe('PENDING');
  });
  it('enforces cooldown and serializes reissue with revocation of all prior pending tokens', async () => {
    const results = await Promise.all([issue(), issue()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const first = code();
    await issue().expect(409);
    fixture.now += 61000;
    await issue(admin.token).expect(201);
    const second = code();
    expect(second).not.toBe(first);
    await accept(first).expect(400);
    await accept(second).expect(200);
    expect(
      await client.invitation.count({
        where: { organizationId: orgId, status: 'REVOKED' },
      }),
    ).toBe(1);
  });
  it('serializes simultaneous acceptance without duplicate membership or audit rows', async () => {
    await issue().expect(201);
    const raw = code();
    const results = await Promise.all([accept(raw), accept(raw)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await client.organizationMember.count({
        where: { organizationId: orgId, userId: staff.id },
      }),
    ).toBe(1);
    expect(
      await client.auditLog.count({
        where: { organizationId: orgId, action: 'invitation.accepted' },
      }),
    ).toBe(1);
  });
  it('activates INVITED membership, preserves active privileges, and cannot bypass suspension', async () => {
    await client.organizationMember.create({
      data: { organizationId: orgId, userId: staff.id, status: 'INVITED' },
    });
    await issue(owner.token, { role: 'ADMIN' }).expect(201);
    await accept(code()).expect(200);
    await issue().expect(409);
    expect(
      (
        await client.organizationMember.findUniqueOrThrow({
          where: {
            organizationId_userId: { organizationId: orgId, userId: staff.id },
          },
        })
      ).role,
    ).toBe('ADMIN');
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { status: 'SUSPENDED' },
    });
    await issue().expect(403);
  });
  it('rejects preissued invitations after recipient suspension, inviter removal or org suspension', async () => {
    await issue().expect(201);
    const raw = code();
    await client.organizationMember.create({
      data: { organizationId: orgId, userId: staff.id, status: 'SUSPENDED' },
    });
    await accept(raw).expect(403);
    await client.organizationMember.deleteMany({
      where: { organizationId: orgId, userId: staff.id },
    });
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: owner.id },
      data: { status: 'SUSPENDED' },
    });
    await accept(raw).expect(403);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: owner.id },
      data: { status: 'ACTIVE' },
    });
    await client.organization.update({
      where: { id: orgId },
      data: { status: 'SUSPENDED' },
    });
    await accept(raw).expect(403);
  });
  it('reports mail failure honestly and allows a later reissue', async () => {
    fixture.send.mockRejectedValueOnce(new Error('private SMTP failure'));
    const result = await issue().expect(201);
    expect(result.body).toMatchObject({ emailDelivery: 'failed' });
    expect(
      await client.invitation.count({
        where: { organizationId: orgId, status: 'PENDING' },
      }),
    ).toBe(1);
    fixture.now += 61000;
    await issue().expect(201);
    await accept(code()).expect(200);
  });
  it('rejects cross-org store injection, unauthorized assignment and inactive targets', async () => {
    await fixture.member(orgId, staff.id);
    const outsider = await fixture.user();
    const other = await fixture.organization(outsider.id);
    const foreignStore = await client.store.create({
      data: { organizationId: other.id, code: 'FOREIGN', name: 'Other' },
    });
    await assign({}, staff.id, foreignStore.id).expect(404);
    await assign({}, outsider.id).expect(403);
    await assign({}, staff.id, storeId, orgId, staff.token).expect(403);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { status: 'SUSPENDED' },
    });
    await assign().expect(403);
    await client.organizationMember.updateMany({
      where: { organizationId: orgId, userId: staff.id },
      data: { status: 'ACTIVE' },
    });
    await client.user.update({
      where: { id: staff.id },
      data: { emailVerifiedAt: null },
    });
    await assign().expect(403);
    await members(outsider.token).expect(403);
    expect(
      await client.storeMember.count({ where: { organizationId: orgId } }),
    ).toBe(0);
  });
  it('assigns and suspends staff idempotently and checks current store roles', async () => {
    await fixture.member(orgId, staff.id);
    const access = app.get(TenantAccessService);
    await assign().expect(200);
    await assign().expect(200);
    expect(
      await client.auditLog.count({
        where: { organizationId: orgId, action: 'store_membership.changed' },
      }),
    ).toBe(1);
    await expect(
      client.$transaction((tx) =>
        access.requireStore(tx, orgId, storeId, staff.id, ['MANAGER']),
      ),
    ).rejects.toThrow();
    await expect(
      client.$transaction((tx) =>
        access.requireStore(tx, orgId, storeId, owner.id, ['MANAGER']),
      ),
    ).resolves.toMatchObject({ id: storeId });
    await assign(
      { role: 'MANAGER' },
      staff.id,
      storeId,
      orgId,
      admin.token,
    ).expect(200);
    await expect(
      client.$transaction((tx) =>
        access.requireStore(tx, orgId, storeId, staff.id, ['MANAGER']),
      ),
    ).resolves.toMatchObject({ id: storeId });
    await assign({ role: 'INVENTORY' }).expect(200);
    await detail().expect(200);
    await assign({ role: 'INVENTORY', status: 'SUSPENDED' }).expect(200);
    await detail().expect(404);
    expect((await stores().expect(200)).body).toEqual([]);
    await assign().expect(200);
    await client.store.update({
      where: { id: storeId },
      data: { status: 'INACTIVE' },
    });
    await detail().expect(404);
    await detail(owner.token).expect(200);
  });
  it('rolls back invitation issue/accept/revoke and assignment when audit persistence fails', async () => {
    const failing = client.$extends({
      query: {
        auditLog: { create: () => Promise.reject(new Error('audit failure')) },
      },
    });
    const access = app.get(TenantAccessService);
    const service = new InvitationsService(
      failing as unknown as PrismaService,
      access,
      app.get(VerificationTokenService),
      app.get(AuthClock),
      app.get(ConfigService),
      app.get(EmailService),
      app.get(SecurityEvents),
    );
    await expect(
      service.issue(owner.id, orgId, { email: staff.email }),
    ).rejects.toThrow('audit failure');
    expect(
      await client.invitation.count({ where: { organizationId: orgId } }),
    ).toBe(0);
    expect(fixture.messages).toHaveLength(0);
    const { invitation } = (await issue().expect(201)).body as {
      invitation: { id: string };
    };
    const raw = code();
    await expect(service.accept(staff.id, raw)).rejects.toThrow(
      'audit failure',
    );
    expect(
      (
        await client.invitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      await client.organizationMember.count({
        where: { organizationId: orgId, userId: staff.id },
      }),
    ).toBe(0);
    await expect(
      service.revoke(owner.id, orgId, invitation.id),
    ).rejects.toThrow('audit failure');
    expect(
      (
        await client.invitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
      ).status,
    ).toBe('PENDING');
    await accept(raw).expect(200);
    await expect(
      new MembershipAccessService(
        failing as unknown as PrismaService,
        access,
      ).assignStore(owner.id, orgId, storeId, staff.id, { role: 'CASHIER' }),
    ).rejects.toThrow('audit failure');
    expect(
      await client.storeMember.count({ where: { organizationId: orgId } }),
    ).toBe(0);
  });
  it('serializes acceptance against revocation with no partial membership', async () => {
    const { invitation } = (await issue().expect(201)).body as {
      invitation: { id: string };
    };
    const raw = code();
    const [accepted, revoked] = await Promise.all([
      accept(raw),
      revoke(invitation.id),
    ]);
    expect([
      [200, 409],
      [400, 200],
    ]).toContainEqual([accepted.status, revoked.status]);
    expect(
      await client.organizationMember.count({
        where: { organizationId: orgId, userId: staff.id },
      }),
    ).toBe(accepted.status === 200 ? 1 : 0);
  });
});
