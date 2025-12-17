import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private telegramService: TelegramService) {}

  @All('webhook')
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    const callback = this.telegramService.getWebhookCallback();
    return callback(req, res);
  }
}
