import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TestDb { url: string; client: PrismaClient; cleanup: () => Promise<void>; }

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'examplehr-'));
  const url = `file:${join(dir, 'test.db')}?connection_limit=1`;
  execSync(`pnpm prisma migrate deploy --schema=prisma/schema.prisma`, {
    cwd: 'C:/Users/Arklok/IdeaProjects/examplehr-timeoff/apps/timeoff-api',
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const client = new PrismaClient({ datasources: { db: { url } } });
  return {
    url,
    client,
    cleanup: async () => {
      await client.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
