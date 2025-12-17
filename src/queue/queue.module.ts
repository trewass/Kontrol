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
      useFactory: (config: ConfigService) => {
        const redisHost = config.get('REDIS_HOST', 'localhost');
        const redisPort = config.get('REDIS_PORT', 6379);
        const redisPassword = config.get('REDIS_PASSWORD');

        const connectionConfig: any = {
          host: redisHost,
          port: redisPort,
        };

        // Add password if provided
        if (redisPassword) {
          connectionConfig.password = redisPassword;
        }

        // Enable TLS for Upstash or production Redis
        if (redisHost.includes('upstash.io') || config.get('REDIS_TLS') === 'true') {
          connectionConfig.tls = {
            rejectUnauthorized: false,
          };
        }

        return { connection: connectionConfig };
      },
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
