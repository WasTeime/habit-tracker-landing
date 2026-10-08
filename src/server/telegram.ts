// Бот листа ожидания: /start записывает, /stop вычёркивает, блокировка бота — тоже вычёркивает.
// Вебхук регистрируется сам при продакшен-сборке на Vercel (scripts/telegram.mjs).
import { createHash } from 'node:crypto';
import { getSecret } from 'astro:env/server';
import { BOT_COPY, DIRECTIONS } from '../content';
import { redisConfigured } from './redis';
import {
  addTgSubscriber,
  countTgSubscribers,
  readTgRef,
  removeTgSubscriber,
  validDirection,
  type TgSubscriber,
} from './waitlist';

export const botToken = (): string => getSecret('TELEGRAM_BOT_TOKEN') ?? '';

// Секрет вебхука выводится из токена — отдельная переменная не нужна. Та же формула в scripts/telegram.mjs
export const webhookSecret = (token: string): string =>
  createHash('sha256').update(`batya-webhook:${token}`).digest('hex').slice(0, 32);

async function api(method: string, params: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const reply = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(`telegram ${method}: ${reply.description ?? `HTTP ${response.status}`}`);
  }
}

const send = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
  api('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra });

const escapeHtml = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

type Chat = { id: number; type: string };
type User = { id: number; first_name?: string; last_name?: string; username?: string };
export type Update = {
  message?: { chat: Chat; from?: User; text?: string };
  my_chat_member?: { chat: Chat; new_chat_member: { status: string } };
};

// Параметр /start: «<направление>_<ref>» или «<ref>» (см. src/scripts/telegram.ts)
function parseStart(payload: string): { direction?: string; ref?: string } {
  const [first, second] = payload.split('_', 2);
  const ref = second ?? first;
  return {
    direction: second ? validDirection(first) : undefined,
    ref: /^[A-Za-z0-9]{8,32}$/.test(ref ?? '') ? ref : undefined,
  };
}

function welcome(direction: string | undefined): string {
  const label = DIRECTIONS.find((d) => d.id === direction)?.label;
  return [BOT_COPY.welcome, label && BOT_COPY.welcomeDirection.replace('{label}', label), BOT_COPY.stopHint]
    .filter(Boolean)
    .join('\n\n');
}

// Имя и username идут только в уведомление админу, в базе их не храним
function who(user: User | undefined, chatId: string): string {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'без имени';
  const link = `<a href="tg://user?id=${chatId}">${escapeHtml(name)}</a>`;
  return user?.username ? `${link} (@${user.username})` : link;
}

/** Новая заявка → сообщение в TELEGRAM_ADMIN_CHAT_ID (можно несколько id через запятую). */
async function notifyAdmin(sub: TgSubscriber, user: User | undefined, saved: boolean): Promise<void> {
  const admins = (getSecret('TELEGRAM_ADMIN_CHAT_ID') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!admins.length) return;
  const total = saved ? await countTgSubscribers().catch(() => null) : null;
  const source = [sub.utm_source, sub.utm_medium, sub.utm_campaign].filter(Boolean).join(' / ');
  const direction = DIRECTIONS.find((d) => d.id === sub.direction)?.label ?? sub.direction;
  const lines = [
    `<b>Новая заявка</b>${total ? ` · всего ${total}` : ''}`,
    `Кто: ${who(user, sub.telegram_id)}`,
    direction && `Направление: ${escapeHtml(direction)}`,
    `Источник: ${escapeHtml(source || 'прямой заход')}`,
    sub.device && `Устройство: ${escapeHtml(sub.device)}`,
    !saved && '⚠️ Не сохранена: не подключён Redis (UPSTASH_REDIS_REST_*)',
  ];
  const html = lines.filter(Boolean).join('\n');
  // Если Telegram не примет разметку (например, ссылку на профиль) — то же самое простым текстом
  const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  await Promise.all(
    admins.map((admin) => send(admin, html, { parse_mode: 'HTML' }).catch(() => send(admin, plain))),
  );
}

async function start(chatId: string, payload: string, user: User | undefined): Promise<void> {
  const { direction, ref } = parseStart(payload);
  const fromClick = ref && redisConfigured() ? await readTgRef(ref) : {};
  const sub: TgSubscriber = {
    ...fromClick,
    direction: direction ?? fromClick.direction,
    telegram_id: chatId,
    created_at: new Date().toISOString(),
  };

  let isNew = true;
  if (redisConfigured()) {
    try {
      isNew = await addTgSubscriber(sub);
    } catch (error) {
      console.error('[telegram] save', error);
      await send(chatId, BOT_COPY.failed);
      return;
    }
  } else {
    console.error('[telegram] Redis не подключён — подписчик не сохранён:', sub);
  }

  // Уведомление админу не зависит от того, дошло ли приветствие
  const results = await Promise.allSettled([
    send(chatId, isNew ? welcome(sub.direction) : BOT_COPY.already),
    isNew ? notifyAdmin(sub, user, redisConfigured()) : null,
  ]);
  for (const result of results) if (result.status === 'rejected') console.error('[telegram]', result.reason);
}

export async function handleUpdate(update: Update): Promise<void> {
  // Заблокировал бота — писать ему больше нельзя, вычёркиваем
  const member = update.my_chat_member;
  if (member?.chat.type === 'private' && member.new_chat_member.status === 'kicked') {
    if (redisConfigured()) await removeTgSubscriber(String(member.chat.id));
    return;
  }

  const message = update.message;
  if (!message || message.chat.type !== 'private') return;
  const chatId = String(message.chat.id);
  const [command = '', payload = ''] = (message.text ?? '').trim().split(/\s+/, 2);

  switch (command.toLowerCase()) {
    case '/start':
      return start(chatId, payload, message.from);
    case '/stop':
      if (redisConfigured()) await removeTgSubscriber(chatId);
      return send(chatId, BOT_COPY.stopped);
    case '/id':
      // Чтобы узнать свой chat id для TELEGRAM_ADMIN_CHAT_ID
      return send(chatId, `Твой chat id: ${chatId}`);
    default:
      return send(chatId, BOT_COPY.idle);
  }
}
