import type { APIRoute } from 'astro';
import { handleUpdate, type Update } from '../../server/telegram';
import { botToken, webhookSecret } from '../../server/tgapi';

export const prerender = false;

// Вебхук бота. Telegram подписывает запросы секретом, который мы задали в setWebhook
export const POST: APIRoute = async ({ request }) => {
  const token = botToken();
  if (!token) return new Response('Not found', { status: 404 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret(token)) {
    return new Response('Forbidden', { status: 403 });
  }

  const update = (await request.json().catch(() => null)) as Update | null;
  try {
    if (update) await handleUpdate(update);
  } catch (error) {
    console.error('[telegram]', error);
  }
  // Всегда 200: иначе Telegram будет повторять это обновление, и человек получит ответ дважды
  return new Response('ok');
};
