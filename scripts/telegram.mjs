// Бот листа ожидания: вебхук и рассылка в день релиза.
//   npm run tg -- info                           — куда смотрит вебхук, последние ошибки, сколько подписчиков
//   npm run tg -- webhook https://<сайт>         — подключить вебхук вручную (на Vercel он подключается сам при продакшен-сборке)
//   npm run tg -- broadcast release.txt          — показать, сколько человек получат сообщение и какое (ничего не отправляет)
//   npm run tg -- broadcast release.txt --send   — разослать
// Переменные берутся из .env: `npx vercel env pull .env` подтянет их с Vercel.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TG_KEY = 'batya:tg'; // как в src/server/waitlist.ts
const SEND_INTERVAL_MS = 40; // ~25 сообщений в секунду, лимит Telegram — 30

// Та же формула, что в src/server/telegram.ts
const webhookSecret = (token) => createHash('sha256').update(`batya-webhook:${token}`).digest('hex').slice(0, 32);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ответ Bot API как есть: { ok, result, description, error_code, parameters } */
async function api(token, method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  return response.json();
}

/** Регистрирует вебхук и меню команд. Вызывается и из astro.config.mjs при сборке на Vercel. */
export async function setWebhook(token, siteUrl) {
  const url = new URL('/api/telegram', siteUrl).toString();
  const reply = await api(token, 'setWebhook', {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  });
  if (!reply.ok) throw new Error(`setWebhook: ${reply.description}`);
  await api(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Позвать меня в день запуска' },
      { command: 'opros', description: 'Пара вопросов, чтобы сделать приложение под тебя' },
      { command: 'stop', description: 'Больше не писать' },
    ],
  });
  return url;
}

// ---------- CLI ----------

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Нет переменной ${name}. Положи её в .env (или: npx vercel env pull .env)`);
    process.exit(1);
  }
  return value;
}

async function redis(...args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error('Нет KV_REST_API_URL / KV_REST_API_TOKEN — подписчики лежат в Upstash Redis');
    process.exit(1);
  }
  const response = await fetch(url.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const reply = await response.json();
  if (reply.error) throw new Error(`redis: ${reply.error}`);
  return reply.result;
}

async function info() {
  const token = need('TELEGRAM_BOT_TOKEN');
  const me = await api(token, 'getMe');
  const hook = await api(token, 'getWebhookInfo');
  if (!me.ok) throw new Error(`getMe: ${me.description}`);
  console.log(`Бот: @${me.result.username}`);
  console.log(`Вебхук: ${hook.result.url || 'не подключён'}`);
  console.log(`В очереди: ${hook.result.pending_update_count}`);
  if (hook.result.last_error_message) {
    const when = new Date(hook.result.last_error_date * 1000).toLocaleString('ru-RU');
    console.log(`Последняя ошибка: ${hook.result.last_error_message} (${when})`);
  }
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    console.log(`Подписчиков: ${await redis('HLEN', TG_KEY)}`);
  }
}

async function sendOne(token, chatId, text) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let reply;
    try {
      reply = await api(token, 'sendMessage', { chat_id: chatId, text });
    } catch (error) {
      reply = { ok: false, description: error.message };
    }
    if (reply.ok) return 'sent';
    // Заблокировал бота или удалил аккаунт — больше не пишем
    if (reply.error_code === 403) return 'gone';
    if (reply.error_code === 400) return reply.description;
    await sleep((reply.parameters?.retry_after ?? 2 ** attempt) * 1000);
  }
  return 'не удалось за 5 попыток';
}

async function broadcast(file, send) {
  const token = need('TELEGRAM_BOT_TOKEN');
  if (!file) {
    console.error('Укажи файл с текстом: npm run tg -- broadcast release.txt');
    process.exit(1);
  }
  const text = (await readFile(file, 'utf8')).trim();
  if (!text) throw new Error(`${file} пустой`);
  if (text.length > 4096) throw new Error(`Сообщение длиннее 4096 символов (${text.length})`);

  const ids = (await redis('HKEYS', TG_KEY)) ?? [];
  console.log(`Получателей: ${ids.length}\n\n${text}\n`);
  if (!send) {
    console.log('Это проверка, ничего не отправлено. Разослать: добавь --send');
    return;
  }

  const stats = { sent: 0, gone: 0, failed: 0 };
  for (const [i, id] of ids.entries()) {
    const result = await sendOne(token, id, text);
    if (result === 'sent') stats.sent++;
    else if (result === 'gone') {
      stats.gone++;
      await redis('HDEL', TG_KEY, id);
    } else {
      stats.failed++;
      console.warn(`${id}: ${result}`);
    }
    if ((i + 1) % 100 === 0) console.log(`…${i + 1} из ${ids.length}`);
    await sleep(SEND_INTERVAL_MS);
  }
  console.log(`Готово. Доставлено: ${stats.sent}, заблокировали бота: ${stats.gone}, ошибок: ${stats.failed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, arg, flag] = process.argv.slice(2);
  try {
    if (command === 'info') await info();
    else if (command === 'webhook') {
      const site = arg || process.env.PUBLIC_SITE_URL;
      if (!site) throw new Error('Укажи адрес сайта: npm run tg -- webhook https://<сайт>');
      console.log(`Вебхук подключён: ${await setWebhook(need('TELEGRAM_BOT_TOKEN'), site)}`);
    } else if (command === 'broadcast') await broadcast(arg, flag === '--send');
    else console.log('Команды: info | webhook <https://сайт> | broadcast <файл> [--send]');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
