import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageJob } from '../queue/message.processor';
import { TasksService } from '../tasks/tasks.service';
import { LlmService } from '../llm/llm.service';
import { TaskStatus, SourceType, Task } from '@prisma/client';
import * as https from 'https';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot;
  private tasksChatId: string;

  constructor(
    private config: ConfigService,
    @InjectQueue('messages') private messageQueue: Queue,
    private tasksService: TasksService,
    private llmService: LlmService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const tasksChatId = this.config.get<string>('TELEGRAM_TASKS_CHAT_ID');
    if (!tasksChatId) {
      throw new Error('TELEGRAM_TASKS_CHAT_ID is not set');
    }
    this.tasksChatId = tasksChatId;

    this.bot = new Bot(token);
  }

  async onModuleInit() {
    this.setupHandlers();
    this.logger.log('Telegram bot initialized');
  }

  private setupHandlers() {
    // Обработка сообщений из групп
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const messageId = ctx.message.message_id.toString();
      const text = ctx.message.text;

      // Игнорируем сообщения из главного чата задач
      if (chatId === this.tasksChatId) {
        return;
      }

      // Игнорируем команды
      if (text.startsWith('/')) {
        return;
      }

      this.logger.debug(`Received message from chat ${chatId}: ${text}`);

      const job: MessageJob = {
        message: text,
        sourceType: SourceType.TELEGRAM,
        sourceExternalId: chatId,
        sourceMessageId: messageId,
        sourceName: ctx.chat.title,
        senderTelegramId: ctx.from?.id?.toString(),
        senderTelegramUsername: ctx.from?.username,
        senderName:
          ctx.from?.first_name +
          (ctx.from?.last_name ? ` ${ctx.from.last_name}` : ''),
      };

      await this.messageQueue.add('process-message', job);
    });

    // Обработка голосовых сообщений
    this.bot.on('message:voice', async (ctx) => {
      await this.handleAudioMessage(
        ctx,
        ctx.message.voice.file_id,
        'voice',
      );
    });

    // Обработка видео сообщений (видео кружки)
    this.bot.on('message:video_note', async (ctx) => {
      await this.handleAudioMessage(
        ctx,
        ctx.message.video_note.file_id,
        'video_note',
      );
    });

    // Обработка аудио файлов
    this.bot.on('message:audio', async (ctx) => {
      await this.handleAudioMessage(
        ctx,
        ctx.message.audio.file_id,
        'audio',
      );
    });

    // Обработка callback query (кнопки)
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const [action, taskId] = data.split(':');

      this.logger.debug(
        `Callback query: ${action} for task ${taskId} from user ${ctx.from.username}`,
      );

      try {
        let newStatus: TaskStatus;
        let emoji: string;
        let label: string;

        switch (action) {
          case 'took':
            newStatus = TaskStatus.IN_PROGRESS;
            emoji = '🔵';
            label = 'В работе';
            break;
          case 'clarify':
            newStatus = TaskStatus.CLARIFICATION;
            emoji = '🟡';
            label = 'Уточняется';
            break;
          case 'postpone':
            newStatus = TaskStatus.POSTPONED;
            emoji = '🟠';
            label = 'Перенесено';
            break;
          case 'done':
            newStatus = TaskStatus.DONE;
            emoji = '✅';
            label = 'Выполнено';
            break;
          case 'reject':
            newStatus = TaskStatus.REJECTED;
            emoji = '🧨';
            label = 'Не задача';
            break;
          default:
            await ctx.answerCallbackQuery({
              text: 'Неизвестное действие',
            });
            return;
        }

        const task = await this.tasksService.updateTaskStatus(
          taskId,
          newStatus,
          undefined,
          ctx.from.username,
        );

        // Если REJECTED — удаляем сообщение
        if (newStatus === TaskStatus.REJECTED) {
          await ctx.deleteMessage();
          await ctx.answerCallbackQuery({
            text: 'Сообщение удалено',
          });
          return;
        }

        // Обновляем сообщение
        const updatedText = this.formatTaskMessage(task, emoji, label);
        const keyboard = this.buildKeyboard(taskId);

        await ctx.editMessageText(updatedText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });

        await ctx.answerCallbackQuery({
          text: `${emoji} ${label}`,
        });
      } catch (error) {
        this.logger.error('Error handling callback query:', error);
        await ctx.answerCallbackQuery({
          text: 'Ошибка обработки',
        });
      }
    });
  }

  private async handleAudioMessage(ctx: any, fileId: string, type: string) {
    const chatId = ctx.chat.id.toString();
    const messageId = ctx.message.message_id.toString();

    // Игнорируем сообщения из главного чата задач
    if (chatId === this.tasksChatId) {
      return;
    }

    this.logger.log(`Received ${type} message from chat ${chatId}`);

    try {
      // Получаем информацию о файле
      const file = await this.bot.api.getFile(fileId);
      const filePath = file.file_path;

      if (!filePath) {
        this.logger.error('File path not found');
        return;
      }

      // Скачиваем аудио файл
      const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

      const audioBuffer = await this.downloadFile(fileUrl);

      // Транскрибируем аудио
      const transcribedText = await this.llmService.transcribeAudio(audioBuffer);

      if (!transcribedText) {
        this.logger.warn('Failed to transcribe audio');
        return;
      }

      this.logger.log(`Transcribed ${type}: ${transcribedText}`);

      // Создаём job для обработки транскрибированного текста
      const job: MessageJob = {
        message: transcribedText,
        sourceType: SourceType.TELEGRAM,
        sourceExternalId: chatId,
        sourceMessageId: messageId,
        sourceName: ctx.chat.title,
        senderTelegramId: ctx.from?.id?.toString(),
        senderTelegramUsername: ctx.from?.username,
        senderName:
          ctx.from?.first_name +
          (ctx.from?.last_name ? ` ${ctx.from.last_name}` : ''),
      };

      await this.messageQueue.add('process-message', job);
    } catch (error) {
      this.logger.error(`Error processing ${type} message:`, error);
    }
  }

  private downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk) => {
            chunks.push(chunk);
          });

          response.on('end', () => {
            resolve(Buffer.concat(chunks));
          });

          response.on('error', (error) => {
            reject(error);
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  async publishTaskToChat(task: any) {
    try {
      const text = this.formatTaskMessage(task);
      const keyboard = this.buildKeyboard(task.id);

      const message = await this.bot.api.sendMessage(this.tasksChatId, text, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });

      // Сохраняем message_id в задаче
      await this.tasksService.updateTaskMessage(
        task.id,
        this.tasksChatId,
        message.message_id.toString(),
      );

      this.logger.log(`Task ${task.id} published to chat ${this.tasksChatId}`);
    } catch (error) {
      this.logger.error('Failed to publish task to chat:', error);
    }
  }

  private formatTaskMessage(
    task: any,
    statusEmoji = '🆕',
    statusLabel = 'Новая',
  ): string {
    let text = `${statusEmoji} <b>${statusLabel}</b>\n\n`;

    text += `<b>${task.title}</b>\n`;

    if (task.description) {
      text += `\n${task.description}\n`;
    }

    if (task.clientName) {
      text += `\n👤 Клиент: ${task.clientName}`;
    }

    if (task.objectName) {
      text += `\n📍 Объект: ${task.objectName}`;
    }

    if (task.assignee) {
      text += `\n👷 Взял: @${task.assignee.telegramUsername || task.assignee.name}`;
    }

    if (task.dueText) {
      text += `\n⏰ Срок: ${task.dueText}`;
    }

    if (task.tags?.length > 0) {
      text += `\n\n🏷 ${task.tags.join(', ')}`;
    }

    if (task.priority === 'HIGH') {
      text += `\n\n🔥 <b>СРОЧНО</b>`;
    }

    text += `\n\n<i>ID: ${task.id.slice(0, 8)}</i>`;

    return text;
  }

  private buildKeyboard(taskId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Взял', `took:${taskId}`)
      .text('🧾 Уточнить', `clarify:${taskId}`)
      .row()
      .text('📅 Перенёс', `postpone:${taskId}`)
      .text('☑️ Закрыл', `done:${taskId}`)
      .row()
      .text('🧨 Не задача', `reject:${taskId}`);
  }

  async sendReminder(task: Task, type: 'new' | 'due_24h' | 'due_2h') {
    let text = '';

    switch (type) {
      case 'new':
        text = `⚠️ <b>Задача не взята!</b>\n\n${task.title}\n\n<i>Создана: ${new Date(task.createdAt).toLocaleString('ru-RU')}</i>`;
        break;
      case 'due_24h':
        text = `📅 <b>Дедлайн завтра!</b>\n\n${task.title}\n\n<i>Срок: ${task.dueText}</i>`;
        break;
      case 'due_2h':
        text = `🚨 <b>Дедлайн через 2 часа!</b>\n\n${task.title}\n\n<i>Срок: ${task.dueText}</i>`;
        break;
    }

    try {
      await this.bot.api.sendMessage(this.tasksChatId, text, {
        parse_mode: 'HTML',
        reply_to_message_id: task.tasksMessageId
          ? parseInt(task.tasksMessageId)
          : undefined,
      });

      await this.tasksService.markReminded(task.id);

      this.logger.log(`Reminder sent for task ${task.id} (type: ${type})`);
    } catch (error) {
      this.logger.error(`Failed to send reminder for task ${task.id}:`, error);
    }
  }

  getWebhookCallback() {
    return webhookCallback(this.bot, 'express');
  }

  async setWebhook(url: string) {
    await this.bot.api.setWebhook(url);
    this.logger.log(`Webhook set to ${url}`);
  }

  async deleteWebhook() {
    await this.bot.api.deleteWebhook();
    this.logger.log('Webhook deleted');
  }

  getBot() {
    return this.bot;
  }
}
