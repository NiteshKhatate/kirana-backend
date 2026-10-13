import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

describe('PrismaService lifecycle', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('connects at startup and disconnects on shutdown', async () => {
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('sanitizes driver connection errors', async () => {
    jest
      .spyOn(service, '$connect')
      .mockRejectedValue(new Error('private database credentials'));
    await expect(service.onModuleInit()).rejects.toThrow(
      'Database connection failed',
    );
  });
});
