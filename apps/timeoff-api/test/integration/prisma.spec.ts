import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';

describe('PrismaService (integration)', () => {
  it('connects and supports raw query', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    // SQLite returns BigInt for integer literals; cast to Number for comparison
    const rows = await prisma.$queryRawUnsafe<{ result: bigint }[]>('SELECT 1 as result');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(Number(rows[0]!.result)).toBe(1);
    await prisma.onModuleDestroy();
  });
});
