import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    user: { findFirst: jest.fn() },
    organization: { create: jest.fn(), findUnique: jest.fn() },
    organizationMember: { findFirst: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn(), findFirst: jest.fn() },
  };
  let service: OrganizationsService;
  beforeEach(() => {
    jest.resetAllMocks();
    tx.user.findFirst.mockResolvedValue({ id: 'user' });
    tx.organization.create.mockResolvedValue({
      id: 'org',
      name: 'Shop',
      slug: 'shop',
      status: 'ONBOARDING',
    });
    service = new OrganizationsService({
      ...tx,
      $transaction: (work: (value: typeof tx) => unknown) => work(tx),
    } as unknown as PrismaService);
  });
  it('creates organization, active owner, onboarding and audit within a single transaction', async () => {
    expect(
      await service.create('user', { name: ' Shop ', slug: ' SHOP ' }),
    ).toMatchObject({ id: 'org', role: 'OWNER' });
    expect(tx.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Shop',
          slug: 'shop',
          status: 'ONBOARDING',
          members: {
            create: { userId: 'user', role: 'OWNER', status: 'ACTIVE' },
          },
          onboarding: { create: { currentStep: 'FIRST_STORE' } },
        }) as unknown,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user',
          action: 'organization.created',
        }) as unknown,
      }),
    );
  });
  it('rejects slug collisions and only resumes matching requests by the active creator-owner', async () => {
    tx.organization.findUnique.mockResolvedValue({
      id: 'org',
      status: 'ONBOARDING',
    });
    await expect(
      service.create('user', { name: 'Shop', slug: 'shop' }),
    ).rejects.toBeInstanceOf(ConflictException);
    tx.auditLog.findFirst.mockResolvedValue({ id: 'creation' });
    tx.organizationMember.findFirst.mockResolvedValue({ role: 'OWNER' });
    await expect(
      service.create('user', { name: 'Shop', slug: 'shop' }),
    ).resolves.toMatchObject({ id: 'org', role: 'OWNER' });
    expect(tx.organization.create).not.toHaveBeenCalled();
  });
  it('does not return an unrelated tenant and lists only current scoped memberships', async () => {
    await expect(service.get('user', 'unrelated')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    tx.organizationMember.findMany.mockResolvedValue([
      { organization: { id: 'org' }, role: 'MEMBER' },
    ]);
    expect(await service.list('user')).toEqual([{ id: 'org', role: 'MEMBER' }]);
    expect(tx.organizationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user',
          status: 'ACTIVE',
          organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
        },
      }),
    );
  });
});
