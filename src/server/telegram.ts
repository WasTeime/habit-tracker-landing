// Бот листа ожидания: /start записывает, /stop вычёркивает, блокировка бота — тоже вычёркивает.
// После подписки предлагает кастдев-опрос (src/server/survey.ts), /opros — пройти его позже.
// Вебхук регистрируется сам при продакшен-сборке на Vercel (scripts/telegram.mjs).
import { BOT_COPY, DIRECTIONS } from '../content';
import { redisConfigured } from './redis';
import {
  cancelSurvey,
  handleSurveyCallback,
  handleSurveyText,
  offerSurvey,
  startSurvey,
  surveyAvailable,
  type CallbackQuery,
} from './survey';
import { escapeHtml, notifyAdmins, send } from './tgapi';
import {
  addTgSubscriber,
  countTgSubscribers,
  readTgRef,
  removeTgSubscriber,
  validDirection,
  type TgSubscriber,
} from './waitlist';

type Chat = { id: number; type: string };
export type Update = {
  message?: { chat: Chat; text?: string };
  callback_query?: CallbackQuery;
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

/** Новая заявка → админу: сколько всего и откуда пришёл. */
async function notifyAdmin(sub: TgSubscriber, saved: boolean): Promise<void> {
  const total = saved ? await countTgSubscribers().catch(() => null) : null;
  const source = [sub.utm_source, sub.utm_medium, sub.utm_campaign].filter(Boolean).join(' / ');
  const lines = [
    `<b>Новая заявка</b>${total ? ` · всего ${total}` : ''}`,
    `Откуда: ${escapeHtml(source || 'прямой заход')}`,
    !saved && '⚠️ Не сохранена: не подключён Redis (UPSTASH_REDIS_REST_*)',
  ];
  await notifyAdmins(lines.filter(Boolean).join('\n'));
}

async function start(chatId: string, payload: string): Promise<void> {
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
    isNew ? notifyAdmin(sub, redisConfigured()) : null,
  ]);
  for (const result of results) if (result.status === 'rejected') console.error('[telegram]', result.reason);
  // Опрос — следующим сообщением после приветствия (и тем, кто подписался раньше, но ещё не отвечал)
  await offerSurvey(chatId).catch((error) => console.error('[telegram] survey', error));
}

export async function handleUpdate(update: Update): Promise<void> {
  // Заблокировал бота — писать ему больше нельзя, вычёркиваем
  const member = update.my_chat_member;
  if (member?.chat.type === 'private' && member.new_chat_member.status === 'kicked') {
    if (redisConfigured()) await removeTgSubscriber(String(member.chat.id));
    await cancelSurvey(String(member.chat.id));
    return;
  }

  // Нажатия на кнопки — пока только в опросе
  if (update.callback_query) return handleSurveyCallback(update.callback_query);

  const message = update.message;
  if (!message || message.chat.type !== 'private') return;
  const chatId = String(message.chat.id);
  const text = (message.text ?? '').trim();
  const [command = '', payload = ''] = text.split(/\s+/, 2);

  switch (command.toLowerCase()) {
    case '/start':
      return start(chatId, payload);
    case '/stop':
      if (redisConfigured()) await removeTgSubscriber(chatId);
      await cancelSurvey(chatId);
      return send(chatId, BOT_COPY.stopped).then(() => {});
    case '/opros':
      return startSurvey(chatId);
    case '/id':
      // Чтобы узнать свой chat id для TELEGRAM_ADMIN_CHAT_ID
      return send(chatId, `Твой chat id: ${chatId}`).then(() => {});
    default: {
      // Посреди опроса текст — это ответ своими словами
      if (text && !text.startsWith('/') && (await handleSurveyText(chatId, text))) return;
      const hint = await surveyAvailable(chatId).catch(() => false);
      await send(chatId, hint ? `${BOT_COPY.idle}\n\n${BOT_COPY.surveyHint}` : BOT_COPY.idle);
    }
  }
}
