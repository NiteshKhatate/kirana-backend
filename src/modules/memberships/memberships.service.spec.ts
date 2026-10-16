import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MembershipsService } from './memberships.service';

describe('Membership owner invariant', () => {
  const tx = {
    $queryRaw: jest.fn(),
    organizationMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  let service: MembershipsService;
  beforeEach(() => {
    jest.resetAllMocks();
    tx.organizationMember.findFirst.mockResolvedValue({ id: 'actor' });
    tx.organizationMember.findUnique.mockResolvedValue({
      id: 'target',
      role: 'OWNER',
      status: 'ACTIVE',
    });
    tx.organizationMember.count.mockResolvedValue(1);
    service = new MembershipsService({
      $transaction: (work: (value: typeof tx) => unknown) => work(tx),
    } as unknown as PrismaService);
  });
  it('locks the organization and rejects demotion or suspension of the final owner', async () => {
    await expect(
      service.changeMember('org', 'actor', 'target', 'ADMIN', 'ACTIVE'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.changeMember('org', 'actor', 'target', 'OWNER', 'SUSPENDED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.organizationMember.update).not.toHaveBeenCalled();
  });
  it('requires a current active owner, and audits permitted changes in the transaction', async () => {
    tx.organizationMember.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.changeMember('org', 'actor', 'target', 'MEMBER', 'ACTIVE'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    tx.organizationMember.count.mockResolvedValue(2);
    await service.changeMember('org', 'actor', 'target', 'MEMBER', 'ACTIVE');
    expect(tx.organizationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'MEMBER', status: 'ACTIVE' } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
