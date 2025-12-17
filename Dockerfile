FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY . .

# Генерируем Prisma Client
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Копируем package.json и устанавливаем только production зависимости
COPY package*.json ./
RUN npm ci --only=production

# Копируем Prisma schema для миграций
COPY prisma ./prisma/

# Копируем собранное приложение из builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Копируем views для веб-админа
COPY views ./views

# Устанавливаем права
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# Запускаем миграции и приложение
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
