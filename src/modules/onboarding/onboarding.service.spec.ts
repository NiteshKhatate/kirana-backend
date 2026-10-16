import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantAccessService } from '../memberships/tenant-access.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const tx = {
    organizationMember: { findFirst: jest.fn() },
    store: { findFirst: jest.fn() },
    onboardingProgress: { findUnique: jest.fn(), update: jest.fn() },
    organization: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const access = { lockOrganization: jest.fn(), requireMember: jest.fn() };
  let service: OnboardingService;
  beforeEach(() => {
    jest.resetAllMocks();
    tx.organizationMember.findFirst.mockResolvedValue({ id: 'owner' });
    tx.store.findFirst.mockResolvedValue({ id: 'store' });
    tx.onboardingProgress.findUnique.mockResolvedValue({
      currentStep: 'REVIEW',
      completedAt: null,
    });
    tx.onboardingProgress.update.mockResolvedValue({
      currentStep: 'COMPLETE',
      completedAt: now,
    });
    service = new OnboardingService(
      {
        $transaction: (work: (value: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      access as unknown as TenantAccessService,
      { now: () => now },
    );
  });
  it.each(['owner', 'store', 'progress'])(
    'requires %s before completion',
    async (missing) => {
      if (missing === 'owner')
        tx.organizationMember.findFirst.mockResolvedValue(null);
      if (missing === 'store') tx.store.findFirst.mockResolvedValue(null);
      if (missing === 'progress')
        tx.onboardingProgress.findUnique.mockResolvedValue(null);
      await expect(service.complete('user', 'org')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.organization.update).not.toHaveBeenCalled();
    },
  );
  it('completes and audits with controlled UTC time, and never repeats the transition', async () => {
    expect(await service.complete('user', 'org')).toMatchObject({
      organizationStatus: 'ACTIVE',
      completedAt: now,
    });
    expect(tx.onboardingProgress.update).toHaveBeenCalledWith({
      where: { organizationId: 'org' },
      data: { currentStep: 'COMPLETE', completedAt: now },
    });
    tx.onboardingProgress.findUnique.mockResolvedValue({
      currentStep: 'COMPLETE',
      completedAt: now,
    });
    await service.complete('user', 'org');
    expect(tx.organization.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
