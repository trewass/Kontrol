import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { TasksService } from '../tasks/tasks.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private remindNewMinutes: number;
  private remindDue24h: boolean;
  private remindDue2h: boolean;

  constructor(
    private config: ConfigService,
    private tasksService: TasksService,
    private telegramService: TelegramService,
  ) {
    this.remindNewMinutes = this.config.get<number>('REMIND_NEW_MINUTES', 30);
    this.remindDue24h = this.config.get<boolean>('REMIND_DUE_24H', true);
    this.remindDue2h = this.config.get<boolean>('REMIND_DUE_2H', true);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkReminders() {
    this.logger.debug('Checking reminders...');

    try {
      const { tasksNew, tasksDue24h, tasksDue2h } =
        await this.tasksService.getTasksForReminders(this.remindNewMinutes);

      // Напоминания о не взятых задачах
      for (const task of tasksNew) {
        await this.telegramService.sendReminder(task, 'new');
      }

      // Напоминания о дедлайнах (24h)
      if (this.remindDue24h) {
        for (const task of tasksDue24h) {
          await this.telegramService.sendReminder(task, 'due_24h');
        }
      }

      // Напоминания о дедлайнах (2h)
      if (this.remindDue2h) {
        for (const task of tasksDue2h) {
          await this.telegramService.sendReminder(task, 'due_2h');
        }
      }

      const totalReminders =
        tasksNew.length + tasksDue24h.length + tasksDue2h.length;

      if (totalReminders > 0) {
        this.logger.log(
          `Sent ${totalReminders} reminders (new: ${tasksNew.length}, due_24h: ${tasksDue24h.length}, due_2h: ${tasksDue2h.length})`,
        );
      }
    } catch (error) {
      this.logger.error('Error checking reminders:', error);
    }
  }
}
