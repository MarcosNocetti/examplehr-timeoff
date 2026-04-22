import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';

describe('PrismaService (integration)', () => {
  it('connects and exposes generated models', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    try {
      const prisma = moduleRef.get(PrismaService);
      const balances = await prisma.balance.findMany();
      expect(Array.isArray(balances)).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });
});
