import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TasksService, CreateTaskDto } from '../tasks/tasks.service';
import { LlmService } from '../llm/llm.service';
import { SourceType } from '@prisma/client';

export interface MessageJob {
  message: string;
  sourceType: SourceType;
  sourceExternalId: string;
  sourceMessageId: string;
  sourceName?: string;
  senderTelegramId?: string;
  senderTelegramUsername?: string;
  senderName?: string;
}

@Processor('messages', { concurrency: 3 })
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private tasksService: TasksService,
    private llmService: LlmService,
  ) {
    super();
  }

  async process(job: Job<MessageJob>): Promise<any> {
    const { message, sourceType, sourceExternalId, sourceMessageId, sourceName, senderTelegramId, senderTelegramUsername, senderName } = job.data;

    this.logger.log(
      `Processing message from ${sourceType}:${sourceExternalId} - ${sourceMessageId}`,
    );

    try {
      const extracted = await this.llmService.extractTask(message, {
        senderName,
        chatName: sourceName,
      });

      if (!extracted) {
        this.logger.debug('Not a task, skipping');
        return { created: false, reason: 'not_a_task' };
      }

      const taskDto: CreateTaskDto = {
        extracted,
        sourceType,
        sourceExternalId,
        sourceMessageId,
        sourceName,
        senderTelegramId,
        senderTelegramUsername,
        senderName,
      };

      const task = await this.tasksService.createTask(taskDto);

      if (!task) {
        this.logger.debug('Task already exists (duplicate)');
        return { created: false, reason: 'duplicate' };
      }

      return { created: true, taskId: task.id, task };
    } catch (error) {
      this.logger.error('Failed to process message:', error);
      throw error;
    }
  }
}
