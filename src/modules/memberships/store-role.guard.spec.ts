import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { StoreRoleGuard } from './store-role.guard';
import { TenantAccessService } from './tenant-access.service';

describe('StoreRoleGuard', () => {
  const requireStore = jest.fn();
  const getAllAndOverride = jest.fn();
  const tx = {};
  const orgId = '1c77f744-7363-4005-b644-a4a2e65c740d',
    storeId = '1c77f744-7363-4005-b644-a4a2e65c740e';
  const context = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;
  const guard = new StoreRoleGuard(
    {
      $transaction: (work: (value: object) => unknown) => work(tx),
    } as unknown as PrismaService,
    { requireStore } as unknown as TenantAccessService,
    { getAllAndOverride } as unknown as Reflector,
  );
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('checks current scoped role requirements rather than claims', async () => {
    getAllAndOverride.mockReturnValue(['MANAGER']);
    await expect(
      guard.canActivate(
        context({
          user: { id: 'user', role: 'OWNER' },
          params: { orgId, storeId },
        }),
      ),
    ).resolves.toBe(true);
    expect(requireStore).toHaveBeenCalledWith(tx, orgId, storeId, 'user', [
      'MANAGER',
    ]);
  });
  it('rejects malformed scope and propagates denied access', async () => {
    await expect(
      guard.canActivate(context({ params: { orgId, storeId } })),
    ).rejects.toThrow();
    expect(requireStore).not.toHaveBeenCalled();
    requireStore.mockRejectedValue(new Error('denied'));
    await expect(
      guard.canActivate(
        context({ user: { id: 'user' }, params: { orgId, storeId } }),
      ),
    ).rejects.toThrow('denied');
  });
});
