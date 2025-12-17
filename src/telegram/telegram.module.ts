import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TasksModule } from '../tasks/tasks.module';
import { QueueModule } from '../queue/queue.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [TasksModule, QueueModule, LlmModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
