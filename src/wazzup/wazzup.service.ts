import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageJob } from '../queue/message.processor';
import { SourceType } from '@prisma/client';

@Injectable()
export class WazzupService {
  private readonly logger = new Logger(WazzupService.name);

  constructor(@InjectQueue('messages') private messageQueue: Queue) {}

  async processMessage(data: any) {
    // Обрабатываем только входящие сообщения
    if (data.direction !== 'incoming') {
      this.logger.debug('Skipping outgoing message');
      return;
    }

    if (!data.text) {
      this.logger.debug('Skipping message without text');
      return;
    }

    this.logger.log(
      `Processing Wazzup message from ${data.chatId}: ${data.text}`,
    );

    const job: MessageJob = {
      message: data.text,
      sourceType: SourceType.WAZZUP,
      sourceExternalId: data.chatId,
      sourceMessageId: data.messageId,
      sourceName: `WhatsApp (${data.senderName || data.senderId})`,
      senderName: data.senderName || data.senderId,
    };

    await this.messageQueue.add('process-message', job);
  }
}
