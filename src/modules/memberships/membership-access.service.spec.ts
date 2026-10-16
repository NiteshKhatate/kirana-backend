import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MembershipAccessService } from './membership-access.service';
import { TenantAccessService } from './tenant-access.service';

describe('Store assignments', () => {
  const tx = {
    store: { findFirst: jest.fn() },
    organizationMember: { findFirst: jest.fn() },
    storeMember: { findUnique: jest.fn(), upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const access = { lockOrganization: jest.fn(), requireMember: jest.fn() };
  let service: MembershipAccessService;
  beforeEach(() => {
    jest.resetAllMocks();
    tx.store.findFirst.mockResolvedValue({ id: 'store' });
    tx.organizationMember.findFirst.mockResolvedValue({ id: 'target' });
    tx.storeMember.upsert.mockResolvedValue({ id: 'assignment' });
    service = new MembershipAccessService(
      {
        $transaction: (work: (value: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      access as unknown as TenantAccessService,
    );
  });
  it('checks store scope and target membership before persisting and auditing', async () => {
    await service.assignStore('actor', 'org', 'store', 'target', {
      role: 'CASHIER',
    });
    expect(tx.store.findFirst).toHaveBeenCalledWith({
      where: { id: 'store', organizationId: 'org' },
      select: { id: true },
    });
    expect(tx.storeMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          organizationId: 'org',
          storeId: 'store',
          userId: 'target',
          role: 'CASHIER',
          status: 'ACTIVE',
        },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('rejects wrong-org stores and inactive/missing target memberships', async () => {
    tx.store.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.assignStore('actor', 'org', 'foreign', 'target', {
        role: 'MANAGER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    tx.organizationMember.findFirst.mockResolvedValue(null);
    await expect(
      service.assignStore('actor', 'org', 'store', 'target', {
        role: 'MANAGER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.storeMember.upsert).not.toHaveBeenCalled();
  });
  it('does not duplicate assignment writes/audits for identical requests', async () => {
    tx.storeMember.findUnique.mockResolvedValue({
      role: 'CASHIER',
      status: 'ACTIVE',
    });
    await service.assignStore('actor', 'org', 'store', 'target', {
      role: 'CASHIER',
    });
    expect(tx.storeMember.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
