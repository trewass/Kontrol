import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { TasksModule } from '../tasks/tasks.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ScheduleModule.forRoot(), TasksModule, TelegramModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
