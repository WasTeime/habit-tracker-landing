// @ts-check
import { defineConfig } from 'astro/config';

// Абсолютный адрес сайта нужен для og:image и canonical.
// На Vercel подхватывается домен продакшена автоматически; свой домен — через PUBLIC_SITE_URL.
const site =
  process.env.PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:4321');

export default defineConfig({
  site,
  trailingSlash: 'never',
  build: {
    // go.html вместо go/index.html; на Vercel чистые адреса включены в vercel.json
    format: 'file',
    // Страница одна, CSS небольшой — инлайним, чтобы не блокировать первый рендер лишним запросом
    inlineStylesheets: 'always',
  },
});
