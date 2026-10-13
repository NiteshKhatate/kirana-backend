import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { publicUserSelect } from './public-user';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findVerifiedActiveUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) return null;
    return user;
  }
}
