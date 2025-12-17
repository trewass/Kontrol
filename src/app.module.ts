import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { LlmModule } from './llm/llm.module';
import { TasksModule } from './tasks/tasks.module';
import { QueueModule } from './queue/queue.module';
import { TelegramModule } from './telegram/telegram.module';
import { WazzupModule } from './wazzup/wazzup.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    LlmModule,
    TasksModule,
    QueueModule,
    TelegramModule,
    WazzupModule,
    SchedulerModule,
    AdminModule,
  ],
})
export class AppModule {}
