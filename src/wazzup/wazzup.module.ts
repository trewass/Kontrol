import { Module } from '@nestjs/common';
import { WazzupController } from './wazzup.controller';
import { WazzupService } from './wazzup.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [WazzupController],
  providers: [WazzupService],
})
export class WazzupModule {}
