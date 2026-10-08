// @ts-check
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';
import { setWebhook } from './scripts/telegram.mjs';

// Абсолютный адрес сайта нужен для og:image и canonical.
// На Vercel подхватывается домен продакшена автоматически; свой домен — через PUBLIC_SITE_URL.
const site =
  process.env.PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:4321');

// Продакшен-сборка на Vercel сама подключает вебхук бота листа ожидания к этому домену.
// Превью-деплои не трогают: у них другой адрес, а бот один.
/** @type {import('astro').AstroIntegration} */
const telegramWebhook = {
  name: 'telegram-webhook',
  hooks: {
    'astro:build:done': async ({ logger }) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token || process.env.VERCEL_ENV !== 'production') return;
      try {
        logger.info(`вебхук бота: ${await setWebhook(token, site)}`);
      } catch (error) {
        logger.warn(`вебхук бота не подключён: ${error instanceof Error ? error.message : error}`);
      }
    },
  },
};

export default defineConfig({
  site,
  trailingSlash: 'never',
  // Страницы остаются статикой; серверные только /api/* (в них prerender = false)
  adapter: vercel(),
  integrations: [telegramWebhook],
  build: {
    // Страница одна, CSS небольшой — инлайним, чтобы не блокировать первый рендер лишним запросом
    inlineStylesheets: 'always',
  },
});
