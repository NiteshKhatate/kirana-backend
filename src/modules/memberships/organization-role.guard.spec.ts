import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { OrganizationRoleGuard } from './organization-role.guard';

describe('OrganizationRoleGuard', () => {
  const findFirst = jest.fn();
  const reflector = { getAllAndOverride: jest.fn() };
  let guard: OrganizationRoleGuard;
  const organizationId = '1c77f744-7363-4005-b644-a4a2e65c740d';
  const context = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;
  beforeEach(() => {
    jest.resetAllMocks();
    guard = new OrganizationRoleGuard(
      { organizationMember: { findFirst } } as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });
  it('checks the current active membership and organization status, ignoring client role claims', async () => {
    reflector.getAllAndOverride.mockReturnValue(['OWNER']);
    findFirst.mockResolvedValue({ role: 'OWNER' });
    await expect(
      guard.canActivate(
        context({
          user: { id: 'user', role: 'MEMBER' },
          params: { orgId: organizationId },
        }),
      ),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        userId: 'user',
        status: 'ACTIVE',
        organization: { status: { in: ['ONBOARDING', 'ACTIVE'] } },
      },
      select: { role: true },
    });
  });
  it.each([null, { role: 'MEMBER' }])(
    'rejects missing, inactive or insufficient membership',
    async (member) => {
      reflector.getAllAndOverride.mockReturnValue(['OWNER', 'ADMIN']);
      findFirst.mockResolvedValue(member);
      await expect(
        guard.canActivate(
          context({
            user: { id: 'user', role: 'OWNER' },
            params: { orgId: organizationId },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('rejects invalid organization IDs and absent authentication before querying', async () => {
    await expect(
      guard.canActivate(context({ params: { orgId: organizationId } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        context({ user: { id: 'user' }, params: { orgId: 'invalid' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
