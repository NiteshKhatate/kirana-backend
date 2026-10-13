import { Prisma, PrismaClient } from '@prisma/client';
import { assertTestDatabaseUrl } from '../../src/config/database-safety';

export async function connectTestDatabase(): Promise<PrismaClient> {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Tests require NODE_ENV=test');
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$connect();
    const [identity] = await client.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database, current_user AS username`;
    if (
      identity?.database !== 'kirana_identity_test' ||
      identity.username !== 'kirana_test'
    ) {
      throw new Error('Unexpected test database identity');
    }
    return client;
  } catch {
    await client.$disconnect();
    throw new Error(
      'Dedicated test database is unavailable or has an unexpected identity',
    );
  }
}

/** Roll back fixtures without truncating tables or deleting existing records. */
export async function withRollback<T>(
  client: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const rollback = new Error('Rollback test transaction');
  let result: T;
  try {
    await client.$transaction(async (transaction) => {
      result = await work(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return result!;
}
