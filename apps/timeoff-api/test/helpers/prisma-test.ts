import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

export interface TestDb { url: string; client: PrismaClient; cleanup: () => Promise<void>; }

/** Walk up from process.cwd() to locate the `apps/timeoff-api` folder
 *  (which owns `prisma/schema.prisma`). Works regardless of whether the
 *  test is launched from the repo root, from the app dir, or from CI. */
function findApiRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'prisma', 'schema.prisma'))) return dir;
    const appDir = join(dir, 'apps', 'timeoff-api', 'prisma', 'schema.prisma');
    if (existsSync(appDir)) return join(dir, 'apps', 'timeoff-api');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `createTestDb: could not locate prisma/schema.prisma by walking up from ${process.cwd()}`,
  );
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'examplehr-'));
  const url = `file:${resolve(dir, 'test.db')}?connection_limit=1`;
  const cwd = findApiRoot();
  execSync(`pnpm prisma migrate deploy --schema=prisma/schema.prisma`, {
    cwd,
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
