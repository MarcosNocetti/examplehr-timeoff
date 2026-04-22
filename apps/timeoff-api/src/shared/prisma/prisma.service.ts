import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    // Enable WAL for better read concurrency on SQLite
    // journal_mode returns a result row, so use $queryRawUnsafe
    await this.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    // foreign_keys=ON does not return rows
    await this.$executeRawUnsafe('PRAGMA foreign_keys=ON');
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
