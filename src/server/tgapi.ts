// Bot API: вызовы, отправка сообщений, уведомления админу. Только для сервера.
import { createHash } from 'node:crypto';
import { getSecret } from 'astro:env/server';

export const botToken = (): string => getSecret('TELEGRAM_BOT_TOKEN') ?? '';

// Секрет вебхука выводится из токена — отдельная переменная не нужна. Та же формула в scripts/telegram.mjs
export const webhookSecret = (token: string): string =>
  createHash('sha256').update(`batya-webhook:${token}`).digest('hex').slice(0, 32);

export type Message = { message_id: number };

export async function api<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(8000),
  });
  const reply = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !reply.ok) throw new Error(`telegram ${method}: ${reply.description ?? `HTTP ${response.status}`}`);
  return reply.result as T;
}

export const send = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
  api<Message>('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra });

export type Button = { text: string; data: string };
/** Кнопки под сообщением: массив рядов. */
export const keyboard = (rows: Button[][]) => ({
  inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
});

export const escapeHtml = (text: string) =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** HTML-сообщение в TELEGRAM_ADMIN_CHAT_ID (можно несколько id через запятую). */
export async function notifyAdmins(html: string): Promise<void> {
  const admins = (getSecret('TELEGRAM_ADMIN_CHAT_ID') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  // Если Telegram не примет разметку — то же самое простым текстом
  const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  await Promise.all(
    admins.map((admin) => send(admin, html, { parse_mode: 'HTML' }).catch(() => send(admin, plain))),
  );
}
