import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantAccessService } from './tenant-access.service';

describe('TenantAccessService', () => {
  const findFirst = jest.fn();
  const store = jest.fn();
  const tx = {
    organizationMember: { findFirst },
    store: { findFirst: store },
  } as unknown as Prisma.TransactionClient;
  const service = new TenantAccessService();
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('rejects inactive/unrelated members before reading a store', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.requireStore(tx, 'org', 'store', 'user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store).not.toHaveBeenCalled();
  });
  it('requires the requested live store role for staff and repeats org membership in the store query', async () => {
    findFirst.mockResolvedValue({ role: 'MEMBER' });
    store.mockResolvedValue({ id: 'store' });
    await service.requireStore(tx, 'org', 'store', 'user', ['MANAGER']);
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'store',
          organizationId: 'org',
          status: 'ACTIVE',
          members: {
            some: {
              organizationId: 'org',
              userId: 'user',
              status: 'ACTIVE',
              role: { in: ['MANAGER'] },
            },
          },
        }) as unknown,
      }),
    );
  });
  it('allows OWNER/ADMIN without store assignments but rejects wrong-org/nonexistent stores', async () => {
    findFirst.mockResolvedValue({ role: 'ADMIN' });
    store.mockResolvedValue(null);
    await expect(
      service.requireStore(tx, 'org', 'wrong-store', 'admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const args = store.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args[0].where.members).toBeUndefined();
    expect(args[0].where.organization).toBeDefined();
  });
});
