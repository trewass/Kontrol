# Структура проекта Kontrol

```
Kontrol/
├── .dockerignore               # Игнорируемые файлы для Docker
├── .env.example                # Пример переменных окружения
├── .gitignore                  # Игнорируемые файлы для Git
├── Dockerfile                  # Multi-stage Docker build
├── README.md                   # Главная документация
├── STRUCTURE.md                # Этот файл
├── docker-compose.yml          # Оркестрация сервисов (app, postgres, redis)
├── nest-cli.json               # Конфигурация NestJS CLI
├── package.json                # Зависимости и скрипты
├── tsconfig.json               # Конфигурация TypeScript
│
├── prisma/
│   ├── schema.prisma           # Схема БД (tasks, task_events, sources, users)
│   └── migrations/             # Миграции PostgreSQL
│       └── .gitkeep
│
├── src/
│   ├── main.ts                 # Точка входа (bootstrap, handlebars setup)
│   ├── app.module.ts           # Корневой модуль (импорты всех модулей)
│   │
│   ├── common/
│   │   └── schemas/
│   │       └── task-extraction.schema.ts  # JSON Schema + AJV валидатор для LLM ответов
│   │
│   ├── database/
│   │   ├── database.module.ts  # Global модуль для Prisma
│   │   └── prisma.service.ts   # PrismaClient с lifecycle hooks
│   │
│   ├── llm/
│   │   ├── llm.module.ts       # LLM модуль
│   │   └── llm.service.ts      # OpenAI API: GPT-4o-mini (извлечение задач) + Whisper-1 (транскрибация аудио)
│   │
│   ├── tasks/
│   │   ├── tasks.module.ts     # Модуль управления задачами
│   │   └── tasks.service.ts    # CRUD задач, дедупликация, поиск, напоминания
│   │
│   ├── queue/
│   │   ├── queue.module.ts     # BullMQ модуль (Redis)
│   │   └── message.processor.ts # Worker: обработка сообщений (LLM → создание задачи)
│   │
│   ├── telegram/
│   │   ├── telegram.module.ts  # Telegram бот модуль
│   │   ├── telegram.service.ts # Grammy: текст, голос, аудио, видео → транскрибация → задачи + callback query
│   │   └── telegram.controller.ts # Webhook endpoint (POST /telegram/webhook)
│   │
│   ├── wazzup/
│   │   ├── wazzup.module.ts    # Wazzup модуль
│   │   ├── wazzup.service.ts   # Обработка WhatsApp сообщений через Wazzup API
│   │   └── wazzup.controller.ts # Webhook endpoint (POST /wazzup/webhook)
│   │
│   ├── scheduler/
│   │   ├── scheduler.module.ts # Scheduler модуль (NestJS Schedule)
│   │   └── scheduler.service.ts # Cron: напоминания (не взяли, дедлайны 24h/2h)
│   │
│   └── admin/
│       ├── admin.module.ts     # Веб-админ модуль
│       └── admin.controller.ts # GET /admin, GET /admin/task/:id
│
├── views/                      # Handlebars шаблоны
│   ├── index.hbs               # Список задач (фильтры, поиск, карточки)
│   └── task-detail.hbs         # Детали задачи + история событий
│
└── examples/                   # Примеры payload для тестирования
    ├── telegram-message.json   # Пример входящего сообщения из Telegram
    ├── telegram-callback.json  # Пример callback query (нажатие кнопки)
    ├── wazzup-webhook-incoming.json   # Пример входящего WhatsApp сообщения
    ├── wazzup-webhook-outgoing.json   # Пример исходящего сообщения (игнорируется)
    ├── wazzup-webhook-complex.json    # Сложная задача с клиентом и объектом
    └── test-scenarios.md       # Подробные сценарии тестирования
```

---

## Основные потоки данных

### 1. Создание задачи из Telegram

```
Telegram Group
   ↓ (message)
TelegramService → adds to BullMQ queue
   ↓
MessageProcessor → LlmService.extractTask()
   ↓ (is_task=true, confidence≥0.7)
TasksService.createTask()
   ↓
Prisma → PostgreSQL (tasks, task_events)
   ↓
TelegramService.publishTaskToChat()
   ↓
Main Chat (inline buttons)
```

### 2. Создание задачи из голосового сообщения

```
Telegram Group
   ↓ (voice/audio/video_note)
TelegramService.handleAudioMessage()
   ↓
Download audio file via Telegram API
   ↓
LlmService.transcribeAudio() → Whisper API
   ↓ (transcribed text)
adds to BullMQ queue
   ↓
MessageProcessor → LlmService.extractTask()
   ↓ (is_task=true, confidence≥0.7)
TasksService.createTask()
   ↓
Prisma → PostgreSQL (tasks, task_events)
   ↓
TelegramService.publishTaskToChat()
   ↓
Main Chat (inline buttons)
```

### 3. Обновление статуса (callback query)

```
User clicks button (e.g., "✅ Взял")
   ↓
TelegramService → callback_query handler
   ↓
TasksService.updateTaskStatus()
   ↓
Prisma → update task.status, create task_event
   ↓
TelegramService → edit message (новый статус + username)
```

### 4. Напоминания (cron)

```
SchedulerService (каждые 5 минут)
   ↓
TasksService.getTasksForReminders()
   ↓
Prisma → найти задачи:
   - NEW + не взяли > N минут
   - due_at через 24h
   - due_at через 2h
   ↓
TelegramService.sendReminder() для каждой
   ↓
Main Chat (reply to original message)
```

---

## База данных (Prisma Schema)

### Таблица: tasks

```prisma
model Task {
  id              String       @id @default(cuid())
  status          TaskStatus   @default(NEW)
  priority        TaskPriority @default(NORMAL)
  title           String
  description     String?
  clientName      String?      @map("client_name")
  objectName      String?      @map("object_name")
  tags            String[]     @default([])
  dueText         String?      @map("due_text")
  dueAt           DateTime?    @map("due_at")
  assigneeId      String?      @map("assignee_id")
  assignee        User?        @relation(fields: [assigneeId], references: [id])
  sourceId        String       @map("source_id")
  source          Source       @relation(fields: [sourceId], references: [id])
  sourceMessageId String       @map("source_message_id")
  tasksMessageId  String?      @map("tasks_message_id")
  tasksChatId     String?      @map("tasks_chat_id")
  confidence      Float        @default(0.0)
  lastRemindedAt  DateTime?    @map("last_reminded_at")
  remindedCount   Int          @default(0) @map("reminded_count")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")
  events          TaskEvent[]

  @@unique([sourceId, sourceMessageId])
  @@index([status])
  @@index([assigneeId])
  @@index([dueAt])
  @@map("tasks")
}
```

**Статусы:**
- `NEW` — только создана
- `IN_PROGRESS` — взята в работу
- `CLARIFICATION` — требуется уточнение
- `POSTPONED` — перенесена
- `DONE` — выполнена
- `REJECTED` — не задача (удалена из чата)

---

## Переменные окружения (.env)

```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"

# Telegram Bot
TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
TELEGRAM_TASKS_CHAT_ID="-1001234567890"

# LLM
LLM_API_KEY="sk-..."
LLM_BASE_URL="https://api.openai.com/v1"
LLM_MODEL="gpt-4o-mini"

# Redis
REDIS_HOST="localhost"
REDIS_PORT=6379

# Reminders
REMIND_NEW_MINUTES=30
REMIND_DUE_24H=true
REMIND_DUE_2H=true

# Server
PORT=3000
NODE_ENV=development
```

---

## API Endpoints

| Endpoint | Метод | Описание | Используется |
|----------|-------|----------|--------------|
| `/telegram/webhook` | POST | Telegram bot webhook | Telegram API |
| `/wazzup/webhook` | POST | Wazzup webhook (WhatsApp) | Wazzup platform |
| `/admin` | GET | Список задач (веб-интерфейс) | Браузер |
| `/admin/task/:id` | GET | Детали задачи + история | Браузер |

---

## Зависимости (ключевые)

### Runtime
- `@nestjs/core` — NestJS framework
- `@prisma/client` — ORM для PostgreSQL
- `grammy` — Telegram Bot API
- `bullmq` — Очередь на Redis
- `openai` — OpenAI SDK (LLM)
- `ajv` — JSON Schema валидация
- `express-handlebars` — Шаблоны для веб-админа

### Dev
- `prisma` — CLI для миграций
- `typescript` — TypeScript compiler
- `@nestjs/cli` — NestJS dev tools

---

## Docker Compose

**Сервисы:**
- `postgres` — PostgreSQL 16 (порт 5432)
- `redis` — Redis 7 (порт 6379)
- `app` — Node.js приложение (порт 3000)

**Volumes:**
- `postgres_data` — данные БД
- `redis_data` — данные очереди

---

## Команды

### Development
```bash
npm install                 # Установить зависимости
npx prisma generate        # Сгенерировать Prisma Client
npx prisma migrate dev     # Применить миграции
npm run start:dev          # Dev-сервер с hot-reload
```

### Production (Docker)
```bash
docker-compose up -d       # Запустить все сервисы
docker-compose logs -f app # Логи приложения
docker-compose down        # Остановить
```

### Database
```bash
npx prisma studio          # GUI для БД
npx prisma migrate deploy  # Применить миграции (prod)
```

---

## Архитектурные решения

### Почему BullMQ?
- Обработка сообщений не блокирует Telegram webhook
- Retry при ошибках LLM
- Concurrency = 3 (параллельная обработка)

### Почему Webhook вместо Polling?
- Меньше задержка (instant delivery)
- Меньше нагрузка на Telegram API
- Production-ready подход

### Почему Prisma?
- Type-safe ORM из коробки
- Миграции + seeding
- Читаемые запросы

### Почему Handlebars для веб-админа?
- Простота (без React/Vue overhead для MVP)
- Server-side rendering (быстрее загрузка)
- Легко поддерживать

---

**Успешной разработки!** 🚀
