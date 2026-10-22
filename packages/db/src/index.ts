import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

export { Prisma };
export type { PrismaClient };

export type TransactionClient = Prisma.TransactionClient;

export function createPrisma(databaseUrl: string): PrismaClient {
  const pool = new Pool({
    connectionString: databaseUrl,
    // Startup option applies before the first query. onConnect covers pools that
    // would otherwise inherit a non-UTC TimeZone from the database or role.
    options: '-c TimeZone=UTC',
    onConnect(client) {
      return client.query("SET TIME ZONE 'UTC'");
    },
  });
  pool.on('error', (error) => {
    console.error('postgres pool error', error);
  });
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError(error) {
      console.error('postgres pool error', error);
    },
  });
  return new PrismaClient({ adapter });
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };
  if (record.code === 'P2002' || record.code === '23505') {
    return true;
  }
  if (record.meta?.code === '23505') {
    return true;
  }
  const message = `${record.message ?? ''}\n${record.meta?.message ?? ''}`;
  return message.includes('23505');
}
