import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>('DATABASE_URL') } },
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch {
      throw new Error('Database connection failed');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
