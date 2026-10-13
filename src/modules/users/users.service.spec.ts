import { PrismaService } from '../../database/prisma.service';
import { UsersService } from './users.service';
import { publicUserSelect } from './public-user';

describe('Safe current-user lookup', () => {
  const findUnique = jest.fn();
  const service = new UsersService({
    user: { findUnique },
  } as unknown as PrismaService);
  it('uses an explicit safe projection', async () => {
    const user = {
      id: 'user-id',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    };
    findUnique.mockResolvedValueOnce(user);
    await expect(service.findVerifiedActiveUser('user-id')).resolves.toEqual(
      user,
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      select: publicUserSelect,
    });
    expect(publicUserSelect).not.toHaveProperty('passwordHash');
  });
  it.each([
    null,
    { status: 'SUSPENDED', emailVerifiedAt: new Date() },
    { status: 'DISABLED', emailVerifiedAt: new Date() },
    { status: 'ACTIVE', emailVerifiedAt: null },
  ])('rejects ineligible account %#', async (user) => {
    findUnique.mockResolvedValueOnce(user);
    await expect(service.findVerifiedActiveUser('user-id')).resolves.toBeNull();
  });
});
