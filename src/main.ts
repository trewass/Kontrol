import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { engine } from 'express-handlebars';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Handlebars setup для веб-админа
  app.engine(
    'hbs',
    engine({
      extname: 'hbs',
      defaultLayout: false,
      helpers: {
        eq: (a: any, b: any) => a === b,
        formatDate: (date: Date) => {
          if (!date) return '-';
          return new Date(date).toLocaleString('ru-RU');
        },
      },
    }),
  );
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Admin panel: http://localhost:${port}/admin`);
  logger.log(`Telegram webhook: http://localhost:${port}/telegram/webhook`);
  logger.log(`Wazzup webhook: http://localhost:${port}/wazzup/webhook`);
}

bootstrap();
