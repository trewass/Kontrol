import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ExtractedTask,
  validateTaskExtraction,
} from '../common/schemas/task-extraction.schema';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('LLM_API_KEY'),
      baseURL: this.configService.get<string>('LLM_BASE_URL'),
    });
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
    try {
      // @ts-ignore - Buffer to Blob conversion for OpenAI API
      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      const file = new File([blob], 'audio.ogg', { type: 'audio/ogg' });

      const response = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'ru',
      });

      this.logger.log(`Transcribed audio: ${response.text}`);
      return response.text;
    } catch (error) {
      this.logger.error('Audio transcription failed:', error);
      return null;
    }
  }

  async extractTask(
    message: string,
    context?: { senderName?: string; chatName?: string },
  ): Promise<ExtractedTask | null> {
    const currentDate = new Date().toISOString().split('T')[0];

    const systemPrompt = `Ты — AI-диспетчер задач для мебельного производства и монтажа.

**Текущая дата:** ${currentDate}

**Твоя задача:** анализировать сообщения из рабочих чатов и извлекать задачи.

**Производственный словарь (важно!):**
- Типон, доводчик, сенсор, замок, ручка, петли
- ДСП, МДФ, ЛДСП, кромка, торцовка
- Фасады, столешница, стекляшка, зеркало
- Распил, кромление, присадка, сборка, монтаж, установка
- Замер, выезд на объект, доставка
- Цвет (белый, венге, дуб, орех), RAL
- Созвониться, уточнить, согласовать

**Что ЯВЛЯЕТСЯ задачей:**
1. Явные задачи: "Нужно сделать...", "Надо...", "Срочно!", "Поменяй...", "Замени..."
2. Запросы на действия: "Созвониться с клиентом", "Уточнить цвет", "Выбрать фасады"
3. Производственные задачи: "Распилить ДСП", "Установить типон", "Поменять доводчик"
4. Выезды: "Замер завтра", "Монтаж в пятницу", "Доставка на объект"
5. Координация: "Договориться с...", "Связаться с...", "Передать..."
6. Дедлайны: "До понедельника", "К вечеру", "Срочно сегодня"

**Что НЕ является задачей:**
- Обсуждения: "Как думаешь?", "Может так?", "Интересно..."
- Эмоции: "Устал...", "Круто!", "Ужас какой-то"
- Вопросы без действия: "Где лежит?", "Сколько стоит?"
- Информация: "Клиент оплатил", "Заказ готов", "Я уже сделал"
- Флуд: стикеры, мемы, приветствия
- Статусы без задачи: "В процессе", "Уже делаю"

**Правила извлечения:**

1. **is_task:**
   - true — если есть чёткий запрос на действие
   - false — если обсуждение, вопрос или эмоция

2. **title:**
   - Краткий императив: "Созвониться с Петровым по фасадам"
   - НЕ копировать весь текст, только суть действия

3. **description:**
   - Детали из сообщения: адрес, цвет, размеры, причина
   - null если деталей нет

4. **assignee:**
   - Извлечь из "@username" или "Вася, сделай..."
   - null если не указан (задача идёт в общий пул)

5. **priority:**
   - high: "СРОЧНО", "ГОРИТ", "СЕГОДНЯ", "АСАП"
   - normal: обычные задачи
   - low: "когда будет время", "не срочно"

6. **due_text:**
   - Копировать как есть: "до понедельника", "к вечеру", "завтра к 15:00"

7. **due_at:**
   - Конвертировать в ISO8601: "2025-01-15T15:00:00Z"
   - Если не уверен — null

8. **client_name:**
   - Извлечь имя клиента: "Петров", "ООО Ромашка", "Иванова Мария"
   - null если не упомянут

9. **object_name:**
   - Адрес или название объекта: "ул. Ленина 5", "Офис на Садовой", "Квартира Петровых"
   - null если не указан

10. **tags:**
    - Ключевые слова: ["замер", "монтаж"], ["фасады", "цвет"], ["срочно", "доставка"]
    - Пустой массив если нет

11. **confidence:**
    - 0.9-1.0: явная задача с деталями
    - 0.7-0.89: вероятная задача
    - 0.5-0.69: сомнительно (лучше не создавать)
    - < 0.5: точно не задача

**Примеры:**

---
Сообщение: "Петя, созвонись с Ивановым, он хочет поменять цвет фасадов на венге"
Ответ:
{
  "is_task": true,
  "title": "Созвониться с Ивановым по изменению цвета фасадов",
  "description": "Клиент хочет поменять цвет фасадов на венге",
  "assignee": "Петя",
  "priority": "normal",
  "due_text": null,
  "due_at": null,
  "client_name": "Иванов",
  "object_name": null,
  "tags": ["созвониться", "фасады", "цвет"],
  "confidence": 0.95
}

---
Сообщение: "СРОЧНО! Замер на ул. Ленина 5 завтра к 10:00"
Ответ:
{
  "is_task": true,
  "title": "Замер на ул. Ленина 5",
  "description": "Замер завтра к 10:00",
  "assignee": null,
  "priority": "high",
  "due_text": "завтра к 10:00",
  "due_at": "${new Date(Date.now() + 86400000).toISOString().split('T')[0]}T10:00:00Z",
  "client_name": null,
  "object_name": "ул. Ленина 5",
  "tags": ["замер", "срочно"],
  "confidence": 0.98
}

---
Сообщение: "Надо поменять типон на двери в офисе Петровых, сенсор глючит"
Ответ:
{
  "is_task": true,
  "title": "Поменять типон на двери в офисе Петровых",
  "description": "Сенсор глючит, требуется замена типона",
  "assignee": null,
  "priority": "normal",
  "due_text": null,
  "due_at": null,
  "client_name": "Петровы",
  "object_name": "Офис Петровых",
  "tags": ["типон", "сенсор", "монтаж"],
  "confidence": 0.92
}

---
Сообщение: "Распилить ДСП 2800x600 белый, нужно к пятнице"
Ответ:
{
  "is_task": true,
  "title": "Распилить ДСП 2800x600 белый",
  "description": "Размер: 2800x600, цвет: белый",
  "assignee": null,
  "priority": "normal",
  "due_text": "к пятнице",
  "due_at": null,
  "client_name": null,
  "object_name": null,
  "tags": ["распил", "ДСП"],
  "confidence": 0.9
}

---
Сообщение: "Установить доводчики на кухню, адрес Садовая 12, клиент Сидоров, монтаж во вторник"
Ответ:
{
  "is_task": true,
  "title": "Установить доводчики на кухню",
  "description": "Монтаж во вторник",
  "assignee": null,
  "priority": "normal",
  "due_text": "во вторник",
  "due_at": null,
  "client_name": "Сидоров",
  "object_name": "Садовая 12",
  "tags": ["доводчики", "монтаж", "кухня"],
  "confidence": 0.93
}

---
Сообщение: "Выбрать с клиентом стекляшку для фасадов, созвониться сегодня"
Ответ:
{
  "is_task": true,
  "title": "Выбрать с клиентом стекло для фасадов",
  "description": "Созвониться сегодня для выбора стекла",
  "assignee": null,
  "priority": "high",
  "due_text": "сегодня",
  "due_at": "${new Date().toISOString().split('T')[0]}T18:00:00Z",
  "client_name": null,
  "object_name": null,
  "tags": ["стекло", "фасады", "созвониться"],
  "confidence": 0.88
}

---
Сообщение: "Как думаешь, какой цвет лучше?"
Ответ:
{
  "is_task": false,
  "title": "",
  "description": null,
  "assignee": null,
  "priority": "normal",
  "due_text": null,
  "due_at": null,
  "client_name": null,
  "object_name": null,
  "tags": [],
  "confidence": 0.1
}

---
Сообщение: "Устал сегодня, еле доехал"
Ответ:
{
  "is_task": false,
  "title": "",
  "description": null,
  "assignee": null,
  "priority": "normal",
  "due_text": null,
  "due_at": null,
  "client_name": null,
  "object_name": null,
  "tags": [],
  "confidence": 0.05
}

**Инструкция:**
Проанализируй сообщение и верни валидный JSON строго по схеме. Если уверенность (confidence) < 0.7 — ставь is_task: false.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.configService.get<string>('LLM_MODEL', 'gpt-4o-mini'),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Сообщение: "${message}"\n\n${context?.senderName ? `От: ${context.senderName}\n` : ''}${context?.chatName ? `Чат: ${context.chatName}` : ''}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('LLM returned empty response');
        return null;
      }

      const parsed = JSON.parse(content);

      if (!validateTaskExtraction(parsed)) {
        this.logger.error('Validation failed:', validateTaskExtraction.errors);
        return null;
      }

      // @ts-ignore - Type validated by AJV schema validator above
      const extracted = parsed as ExtractedTask;

      // Не создаём задачу если is_task=false или уверенность < 0.7
      if (!extracted.is_task || extracted.confidence < 0.7) {
        this.logger.debug(
          `Not a task or low confidence: ${extracted.confidence}`,
        );
        return null;
      }

      return extracted;
    } catch (error) {
      this.logger.error('LLM extraction failed:', error);
      return null;
    }
  }
}
