import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EmployeeRepository } from './employee.repository';
import { Role } from '@examplehr/contracts';

@Injectable()
export class EmployeeSeederService implements OnApplicationBootstrap {
  private readonly log = new Logger(EmployeeSeederService.name);

  constructor(private readonly repo: EmployeeRepository) {}

  async onApplicationBootstrap() {
    if (process.env.SKIP_SEED === '1') return;
    const existing = await this.repo.listAll();
    if (existing.length > 0) {
      this.log.log(`Employee seed skipped — ${existing.length} record(s) already exist.`);
      return;
    }

    // Create demo org: 1 admin, 1 manager, 2 employees reporting to the manager.
    const admin = await this.repo.create({
      name: 'Alice Admin',
      email: 'alice@examplehr.dev',
      role: Role.ADMIN,
    });
    const manager = await this.repo.create({
      name: 'Mary Manager',
      email: 'mary@examplehr.dev',
      role: Role.MANAGER,
    });
    const e1 = await this.repo.create({
      name: 'Eddie Employee',
      email: 'eddie@examplehr.dev',
      role: Role.EMPLOYEE,
      managerId: manager.id,
    });
    const e2 = await this.repo.create({
      name: 'Emma Employee',
      email: 'emma@examplehr.dev',
      role: Role.EMPLOYEE,
      managerId: manager.id,
    });

    this.log.log(
      `Seeded employees: admin=${admin.id}, manager=${manager.id}, employees=[${e1.id}, ${e2.id}]`,
    );
  }
}
