import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { TenantAccessService } from '../memberships/tenant-access.service';
import { VerificationTokenService } from '../auth/verification-token.service';
import { EmailService } from '../email/email.service';
import { SecurityEvents } from '../audit/security-events.service';
import { InvitationsService } from './invitations.service';

describe('InvitationsService', () => {
  const now = new Date('2026-10-16T12:00:00Z'),
    raw = 'a'.repeat(64);
  const tx = {
    invitation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    organizationMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const access = { lockOrganization: jest.fn(), requireMember: jest.fn() },
    mail = { sendInvitation: jest.fn() },
    events = { record: jest.fn() };
  const tokens = new VerificationTokenService();
  let service: InvitationsService;
  const invitation = {
    id: 'invitation',
    organizationId: 'org',
    email: 'staff@example.com',
    role: 'MEMBER',
    status: 'PENDING',
    invitedById: 'owner',
    expiresAt: new Date(now.getTime() + 10000),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    access.requireMember.mockResolvedValue({ role: 'OWNER' });
    tx.invitation.findMany.mockResolvedValue([]);
    tx.invitation.findUnique.mockResolvedValue(invitation);
    tx.invitation.create.mockResolvedValue(invitation);
    tx.user.findFirst.mockResolvedValue({ email: invitation.email });
    tx.invitation.updateMany.mockResolvedValue({ count: 1 });
    tx.organizationMember.upsert.mockResolvedValue({
      organizationId: 'org',
      userId: 'staff',
      role: 'MEMBER',
      status: 'ACTIVE',
    });
    mail.sendInvitation.mockResolvedValue('smtp-accepted');
    jest.spyOn(tokens, 'create').mockReturnValue(raw);
    service = new InvitationsService(
      {
        ...tx,
        $transaction: (work: (value: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      access as unknown as TenantAccessService,
      tokens,
      { now: () => now },
      new ConfigService({ INVITATIONS: { ttlSeconds: 604800 } }),
      mail as unknown as EmailService,
      events as unknown as SecurityEvents,
    );
  });
  afterEach(() => jest.restoreAllMocks());
  it('normalizes email, hashes the one-time code, and never returns it', async () => {
    const result = await service.issue('owner', 'org', {
      email: ' STAFF@Example.com ',
    });
    expect(tx.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'staff@example.com',
          tokenHash: tokens.hash(raw),
          invitedById: 'owner',
          role: 'MEMBER',
        }) as unknown,
      }),
    );
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(result.emailDelivery).toBe('smtp-accepted');
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('keeps committed invitations on delivery failure and reports failure safely', async () => {
    mail.sendInvitation.mockRejectedValueOnce(
      new Error('private SMTP credentials'),
    );
    expect(
      await service.issue('owner', 'org', { email: invitation.email }),
    ).toMatchObject({ emailDelivery: 'failed' });
    expect(events.record).toHaveBeenCalledWith(
      'invitation.delivery_failed',
      'owner',
    );
  });
  it('enforces role ceilings and cooldown before creating or sending mail', async () => {
    access.requireMember.mockResolvedValueOnce({ role: 'ADMIN' });
    await expect(
      service.issue('admin', 'org', { email: invitation.email, role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    tx.invitation.findFirst.mockResolvedValueOnce({ id: 'recent' });
    await expect(
      service.issue('owner', 'org', { email: invitation.email }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendInvitation).not.toHaveBeenCalled();
  });
  it.each(['REVOKED', 'EXPIRED'])('rejects %s invitations', async (status) => {
    tx.invitation.findUnique.mockResolvedValue({ ...invitation, status });
    await expect(service.accept('staff', raw)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.organizationMember.upsert).not.toHaveBeenCalled();
  });
  it('rejects mismatched email, expiry, consumed codes, and suspended memberships', async () => {
    tx.user.findFirst.mockResolvedValueOnce({ email: 'other@example.com' });
    await expect(service.accept('staff', raw)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    tx.invitation.findUnique
      .mockResolvedValueOnce({ organizationId: 'org' })
      .mockResolvedValueOnce({ ...invitation, expiresAt: now });
    await expect(service.accept('staff', raw)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    tx.invitation.findUnique
      .mockResolvedValueOnce({ organizationId: 'org' })
      .mockResolvedValueOnce({ ...invitation, status: 'ACCEPTED' });
    await expect(service.accept('staff', raw)).rejects.toBeInstanceOf(
      ConflictException,
    );
    tx.organizationMember.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(service.accept('staff', raw)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('rechecks inviter privileges before consuming and creates membership and audit together', async () => {
    const result = await service.accept('staff', raw);
    expect(result).toMatchObject({ userId: 'staff', role: 'MEMBER' });
    expect(access.requireMember).toHaveBeenCalledWith(tx, 'org', 'owner', [
      'OWNER',
      'ADMIN',
    ]);
    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'invitation', status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('does not consume an invitation if audit persistence fails', async () => {
    tx.auditLog.create.mockRejectedValueOnce(new Error('audit failure'));
    await expect(service.accept('staff', raw)).rejects.toThrow('audit failure');
    // Real rollback is verified against PostgreSQL, rather than simulated by these mocks.
  });
});
