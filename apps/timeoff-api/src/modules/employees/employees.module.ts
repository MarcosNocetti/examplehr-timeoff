import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeeRepository } from './employee.repository';
import { EmployeeSeederService } from './employee-seeder.service';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeeRepository, EmployeeSeederService],
  exports: [EmployeeRepository],
})
export class EmployeesModule {}
