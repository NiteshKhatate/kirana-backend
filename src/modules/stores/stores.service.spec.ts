import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StoresService } from './stores.service';

describe('StoresService', () => {
  const tx = {
    store: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    onboardingProgress: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const access = {
    lockOrganization: jest.fn(),
    requireMember: jest.fn(),
    requireStore: jest.fn(),
  };
  let service: StoresService;
  beforeEach(() => {
    jest.resetAllMocks();
    access.requireMember.mockResolvedValue({ role: 'OWNER' });
    tx.store.create.mockResolvedValue({ id: 'store' });
    service = new StoresService(
      {
        $transaction: (work: (value: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      access,
    );
  });
  it('locks and authorizes before creating a normalized store, progress and audit', async () => {
    await service.create('user', 'org', { code: ' main ', name: ' Shop ' });
    expect(access.requireMember).toHaveBeenCalledWith(tx, 'org', 'user', [
      'OWNER',
      'ADMIN',
    ]);
    expect(tx.store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org',
          code: 'MAIN',
          name: 'Shop',
          country: 'IN',
        }) as unknown,
      }),
    );
    expect(tx.onboardingProgress.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        currentStep: 'FIRST_STORE',
        completedAt: null,
      },
      data: { currentStep: 'REVIEW' },
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('resumes an identical code/payload and conflicts on differing data', async () => {
    const store = {
      id: 'store',
      code: 'MAIN',
      name: 'Shop',
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: 'IN',
    };
    tx.store.findUnique.mockResolvedValue(store);
    expect(
      await service.create('user', 'org', { code: 'main', name: 'Shop' }),
    ).toEqual(store);
    await expect(
      service.create('user', 'org', { code: 'main', name: 'Changed' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.store.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('filters staff lists through both active organization and store membership', async () => {
    access.requireMember.mockResolvedValue({ role: 'MEMBER' });
    await service.list('user', 'org');
    expect(tx.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          status: 'ACTIVE',
          members: {
            some: { userId: 'user', organizationId: 'org', status: 'ACTIVE' },
          },
        }) as unknown,
      }),
    );
  });
});
