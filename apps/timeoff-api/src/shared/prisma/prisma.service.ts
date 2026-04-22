import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    // WAL is a database-level setting that persists in the SQLite file after
    // the first call. We still issue it on every boot to ensure the file is
    // in WAL mode regardless of how it was created (defensive).
    await this.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    // foreign_keys is per-connection. We rely on connection_limit=1 in
    // DATABASE_URL to ensure a single connection lives for the app's lifetime,
    // so this PRAGMA stays effective.
    await this.$executeRawUnsafe('PRAGMA foreign_keys=ON');
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
