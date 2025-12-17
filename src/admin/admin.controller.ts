import { Controller, Get, Post, Query, Render, Param, Body, Redirect } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { TaskStatus, SourceType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(
    private tasksService: TasksService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @Render('index')
  async index(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const filters: any = {};

    if (status && status !== 'ALL') {
      filters.status = status as TaskStatus;
    }

    if (search) {
      filters.search = search;
    }

    const tasks = await this.tasksService.getTasks(filters);

    return {
      tasks,
      statusFilter: status || 'ALL',
      searchQuery: search || '',
      statuses: ['ALL', 'NEW', 'IN_PROGRESS', 'CLARIFICATION', 'POSTPONED', 'DONE', 'REJECTED'],
    };
  }

  @Get('task/:id')
  @Render('task-detail')
  async taskDetail(@Param('id') id: string) {
    const task = await this.tasksService.getTaskById(id);

    if (!task) {
      return { error: 'Task not found' };
    }

    return { task };
  }

  @Get('sources')
  @Render('sources')
  async sources() {
    const sources = await this.prisma.source.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { sources };
  }

  @Post('sources')
  @Redirect('/admin/sources')
  async createSource(
    @Body('type') type: string,
    @Body('externalId') externalId: string,
    @Body('name') name: string,
  ) {
    await this.prisma.source.create({
      data: {
        type: type as SourceType,
        externalId,
        name,
      },
    });
    return;
  }
}
