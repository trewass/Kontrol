import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MessageProcessor } from './message.processor';
import { TasksModule } from '../tasks/tasks.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'messages',
    }),
    TasksModule,
    LlmModule,
  ],
  providers: [MessageProcessor],
  exports: [BullModule],
})
export class QueueModule {}
