import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TaskStatus, TaskPriority, SourceType, EventType } from '@prisma/client';
import { ExtractedTask } from '../common/schemas/task-extraction.schema';

export interface CreateTaskDto {
  extracted: ExtractedTask;
  sourceType: SourceType;
  sourceExternalId: string;
  sourceMessageId: string;
  sourceName?: string;
  senderTelegramId?: string;
  senderTelegramUsername?: string;
  senderName?: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private prisma: PrismaService) {}

  async createTask(dto: CreateTaskDto) {
    const {
      extracted,
      sourceType,
      sourceExternalId,
      sourceMessageId,
      sourceName,
      senderTelegramId,
      senderTelegramUsername,
      senderName,
    } = dto;

    // Проверка дедупликации
    const existing = await this.prisma.task.findFirst({
      where: {
        source: {
          type: sourceType,
          externalId: sourceExternalId,
        },
        sourceMessageId,
      },
    });

    if (existing) {
      this.logger.debug(
        `Task already exists for message ${sourceMessageId} from ${sourceType}:${sourceExternalId}`,
      );
      return null;
    }

    // Создание или получение source
    const source = await this.prisma.source.upsert({
      where: {
        type_externalId: {
          type: sourceType,
          externalId: sourceExternalId,
        },
      },
      create: {
        type: sourceType,
        externalId: sourceExternalId,
        name: sourceName,
      },
      update: {},
    });

    // Создание или получение пользователя (если есть assignee или отправитель)
    let assigneeUser: { id: string } | null = null;
    if (extracted.assignee) {
      assigneeUser = await this.findOrCreateUser(extracted.assignee);
    }

    // Если отправитель указан, создаём/обновляем его
    if (senderTelegramId || senderTelegramUsername) {
      await this.prisma.user.upsert({
        where: senderTelegramId
          ? { telegramId: senderTelegramId }
          : { telegramUsername: senderTelegramUsername },
        create: {
          telegramId: senderTelegramId,
          telegramUsername: senderTelegramUsername,
          name: senderName,
        },
        update: {
          name: senderName || undefined,
        },
      });
    }

    // Конвертация приоритета
    const priority = this.mapPriority(extracted.priority);

    // Парсинг due_at
    let dueAt: Date | null = null;
    if (extracted.due_at) {
      try {
        dueAt = new Date(extracted.due_at);
      } catch {
        this.logger.warn(`Invalid due_at: ${extracted.due_at}`);
      }
    }

    // Создание задачи
    const task = await this.prisma.task.create({
      data: {
        title: extracted.title,
        description: extracted.description,
        priority,
        clientName: extracted.client_name,
        objectName: extracted.object_name,
        tags: extracted.tags,
        dueText: extracted.due_text,
        dueAt,
        confidence: extracted.confidence,
        sourceId: source.id,
        sourceMessageId,
        assigneeId: assigneeUser?.id,
      },
      include: {
        source: true,
        assignee: true,
      },
    });

    // Создание события
    await this.prisma.taskEvent.create({
      data: {
        taskId: task.id,
        type: EventType.CREATED,
        newStatus: TaskStatus.NEW,
        userId: assigneeUser?.id,
      },
    });

    this.logger.log(`Task created: ${task.id} - ${task.title}`);

    return task;
  }

  async updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus,
    userId?: string,
    assigneeUsername?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const oldStatus = task.status;

    let assigneeUser: { id: string } | null = null;
    if (assigneeUsername) {
      assigneeUser = await this.findOrCreateUser(assigneeUsername);
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        assigneeId: assigneeUser?.id || task.assigneeId,
      },
      include: {
        assignee: true,
      },
    });

    await this.prisma.taskEvent.create({
      data: {
        taskId,
        type: EventType.STATUS_CHANGED,
        oldStatus,
        newStatus,
        userId,
      },
    });

    this.logger.log(
      `Task ${taskId} status changed: ${oldStatus} -> ${newStatus}`,
    );

    return updated;
  }

  async updateTaskMessage(
    taskId: string,
    tasksChatId: string,
    tasksMessageId: string,
  ) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        tasksChatId,
        tasksMessageId,
      },
    });
  }

  async markReminded(taskId: string) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        lastRemindedAt: new Date(),
        remindedCount: { increment: 1 },
      },
    });
  }

  async getTasksForReminders(remindNewMinutes: number) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - remindNewMinutes * 60 * 1000);

    const tasksNew = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.NEW,
        createdAt: { lte: cutoff },
        OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: cutoff } }],
      },
      include: { assignee: true },
    });

    const tasksDue24h = await this.prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.NEW, TaskStatus.IN_PROGRESS] },
        dueAt: {
          gte: new Date(now.getTime() + 23 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 25 * 60 * 60 * 1000),
        },
        lastRemindedAt: { lte: cutoff },
      },
      include: { assignee: true },
    });

    const tasksDue2h = await this.prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.NEW, TaskStatus.IN_PROGRESS] },
        dueAt: {
          gte: new Date(now.getTime() + 1 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        },
        lastRemindedAt: { lte: cutoff },
      },
      include: { assignee: true },
    });

    return { tasksNew, tasksDue24h, tasksDue2h };
  }

  async getTasks(filters?: {
    status?: TaskStatus;
    assigneeId?: string;
    search?: string;
  }) {
    return this.prisma.task.findMany({
      where: {
        status: filters?.status,
        assigneeId: filters?.assigneeId,
        OR: filters?.search
          ? [
              { title: { contains: filters.search, mode: 'insensitive' } },
              {
                description: { contains: filters.search, mode: 'insensitive' },
              },
              {
                clientName: { contains: filters.search, mode: 'insensitive' },
              },
              {
                objectName: { contains: filters.search, mode: 'insensitive' },
              },
            ]
          : undefined,
      },
      include: {
        assignee: true,
        source: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getTaskById(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: {
        assignee: true,
        source: true,
        events: {
          include: { user: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  private async findOrCreateUser(username: string) {
    return this.prisma.user.upsert({
      where: { telegramUsername: username },
      create: {
        telegramUsername: username,
        name: username,
      },
      update: {},
    });
  }

  private mapPriority(priority: 'low' | 'normal' | 'high'): TaskPriority {
    const map = {
      low: TaskPriority.LOW,
      normal: TaskPriority.NORMAL,
      high: TaskPriority.HIGH,
    };
    return map[priority];
  }
}
