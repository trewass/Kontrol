# Быстрый запуск Kontrol

## Текущая ситуация

Вы видите пустой экран на `http://localhost:3000`, потому что:
1. Не создан `.env` файл с настройками
2. Не установлены зависимости (`node_modules` отсутствует)
3. Не запущены PostgreSQL и Redis

## Вариант 1: Установка Docker (рекомендуется)

Самый простой способ запустить приложение:

### 1. Установить Docker Desktop
```bash
# Скачайте и установите с https://www.docker.com/products/docker-desktop
# Или через Homebrew:
brew install --cask docker
```

### 2. Создать .env файл
```bash
cp .env.example .env
```

Отредактируйте `.env` и заполните:
- `TELEGRAM_BOT_TOKEN` - получить от @BotFather в Telegram
- `TELEGRAM_TASKS_CHAT_ID` - ID вашего главного чата задач
- `LLM_API_KEY` - ваш OpenAI API ключ

### 3. Запустить все сервисы
```bash
docker compose up -d
```

### 4. Открыть админку
```
http://localhost:3000/admin
```

---

## Вариант 2: Локальный запуск (без Docker)

Если Docker не нужен, но нужно больше контроля:

### 1. Установить PostgreSQL
```bash
# macOS:
brew install postgresql@16
brew services start postgresql@16

# Создать базу данных:
createdb kontrol
createuser -P kontrol  # Пароль: kontrol
```

### 2. Установить Redis
```bash
# macOS:
brew install redis
brew services start redis
```

### 3. Создать .env файл
```bash
cp .env.example .env
```

Заполните все переменные (см. Вариант 1)

### 4. Установить зависимости
```bash
npm install
```

### 5. Запустить миграции
```bash
npx prisma generate
npx prisma migrate dev
```

### 6. Запустить приложение
```bash
npm run start:dev
```

### 7. Открыть админку
```
http://localhost:3000/admin
```

---

## Вариант 3: Только посмотреть код (без запуска)

Если вы хотите просто изучить архитектуру без запуска:

### Ключевые файлы для изучения:

1. **Архитектура:**
   - [STRUCTURE.md](STRUCTURE.md) - структура проекта
   - [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - общий обзор

2. **Основной код:**
   - [src/telegram/telegram.service.ts](src/telegram/telegram.service.ts) - бот с транскрибацией
   - [src/llm/llm.service.ts](src/llm/llm.service.ts) - LLM + Whisper
   - [src/tasks/tasks.service.ts](src/tasks/tasks.service.ts) - бизнес-логика задач
   - [src/queue/message.processor.ts](src/queue/message.processor.ts) - обработка очереди

3. **База данных:**
   - [prisma/schema.prisma](prisma/schema.prisma) - схема БД

4. **Веб-интерфейс:**
   - [views/index.hbs](views/index.hbs) - список задач
   - [views/task-detail.hbs](views/task-detail.hbs) - детали задачи

---

## Что делать дальше?

Выберите один из вариантов выше, и я помогу с настройкой!

**Рекомендация:** Используйте **Вариант 1 (Docker)** - это быстрее всего.
