import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  controllers: [AdminController],
})
export class AdminModule {}
