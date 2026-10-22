import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

export { Prisma };
export type { PrismaClient };

export type TransactionClient = Prisma.TransactionClient;

export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg(
    { connectionString: databaseUrl },
    {
      onPoolError(error) {
        console.error('postgres pool error', error);
      },
    },
  );
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
