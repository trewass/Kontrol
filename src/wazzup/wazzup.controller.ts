import { Body, Controller, Post, Logger } from '@nestjs/common';
import { WazzupService } from './wazzup.service';

export interface WazzupWebhookPayload {
  event: 'message' | 'status';
  data: {
    messageId: string;
    chatId: string;
    chatType: 'whatsapp' | 'telegram';
    senderId: string;
    senderName?: string;
    text?: string;
    timestamp: number;
    direction: 'incoming' | 'outgoing';
  };
}

@Controller('wazzup')
export class WazzupController {
  private readonly logger = new Logger(WazzupController.name);

  constructor(private wazzupService: WazzupService) {}

  @Post('webhook')
  async handleWebhook(@Body() payload: WazzupWebhookPayload) {
    this.logger.log(`Received Wazzup webhook: ${payload.event}`);

    if (payload.event === 'message' && payload.data.text) {
      await this.wazzupService.processMessage(payload.data);
    }

    return { status: 'ok' };
  }
}
