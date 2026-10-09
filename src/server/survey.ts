// Кастдев-опрос в боте: вопросы с кнопками, можно ответить своими словами, последний — открытый.
// 152-ФЗ: ответы анонимные — хранятся под случайным id, без chat_id и имени. Смотреть — /api/survey.csv
import { randomBytes } from 'node:crypto';
import { SURVEY } from '../content';
import { command, hashEntries, redisConfigured } from './redis';
import { api, keyboard, send } from './tgapi';
import { ATTRIBUTION_FIELDS, readTgSubscriber } from './waitlist';

const QUESTIONS = SURVEY.questions;
const RESPONSES_KEY = 'batya:survey';
// Кто уже прошёл — только факт, без ответов: чтобы не предлагать опрос второй раз
const DONE_KEY = 'batya:survey:done';
const STATE_TTL = 7 * 24 * 3600; // недопройденный опрос забываем через неделю
const stateKey = (chatId: string) => `batya:survey:state:${chatId}`;
const lockKey = (chatId: string) => `batya:survey:lock:${chatId}`;

export const SURVEY_FIELDS = ['created_at', ...ATTRIBUTION_FIELDS, ...QUESTIONS.map((q) => q.id)];

type State = { step: number; answers: Record<string, string>; msg?: number; started_at: string };
type Response = Record<string, string>;

export type CallbackQuery = {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number; type: string } };
};

async function readState(chatId: string): Promise<State | null> {
  const raw = (await command('GET', stateKey(chatId))) as string | null;
  return raw ? (JSON.parse(raw) as State) : null;
}

const saveState = (chatId: string, state: State) =>
  command('SET', stateKey(chatId), JSON.stringify(state), 'EX', String(STATE_TTL));

const isDone = async (chatId: string) => Number(await command('SISMEMBER', DONE_KEY, chatId)) === 1;

// Два быстрых нажатия подряд не должны засчитаться двумя ответами
async function withLock(chatId: string, fn: () => Promise<void>): Promise<boolean> {
  if ((await command('SET', lockKey(chatId), '1', 'EX', '10', 'NX')) !== 'OK') return false;
  try {
    await fn();
  } finally {
    await command('DEL', lockKey(chatId)).catch(() => {});
  }
  return true;
}

const questionText = (step: number) => `${step + 1}/${QUESTIONS.length}. ${QUESTIONS[step].text}`;

function questionKeyboard(step: number) {
  const options: readonly string[] = QUESTIONS[step].options;
  if (!options.length) return keyboard([[{ text: SURVEY.skip, data: `s:${step}:-` }]]);
  return keyboard(options.map((text, i) => [{ text, data: `s:${step}:${i}` }]));
}

async function ask(chatId: string, state: State): Promise<void> {
  const message = await send(chatId, questionText(state.step), { reply_markup: questionKeyboard(state.step) });
  await saveState(chatId, { ...state, msg: message.message_id });
}

// Кнопки под отвеченным вопросом убираем. Ошибки глушим: сообщение могли удалить — опросу это не мешает
const removeButtons = (chatId: string, messageId: number) =>
  api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId }).catch(() => {});

// …а выбранный кнопкой вариант дописываем под вопрос, чтобы было видно, что засчитано
const showAnswer = (chatId: string, messageId: number, step: number, answer: string) =>
  api('editMessageText', { chat_id: chatId, message_id: messageId, text: `${questionText(step)}\n\n✓ ${answer}` }).catch(
    () => {},
  );

async function advance(chatId: string, state: State, value: string): Promise<void> {
  const answers = { ...state.answers, [QUESTIONS[state.step].id]: value };
  if (state.step + 1 < QUESTIONS.length) return ask(chatId, { ...state, answers, step: state.step + 1 });

  const response: Response = {
    created_at: new Date().toISOString(),
    // Направление и источник — из подписки, чтобы сравнивать ответы по рекламе. Сам id не берём
    ...(await readTgSubscriber(chatId)),
    ...answers,
  };
  await command('HSET', RESPONSES_KEY, randomBytes(8).toString('hex'), JSON.stringify(response));
  await command('SADD', DONE_KEY, chatId);
  await command('DEL', stateKey(chatId));
  await send(chatId, SURVEY.done);
}

// ---------- вызовы из бота ----------

/** После «Запустить»: предложить опрос, если ещё не проходил. */
export async function offerSurvey(chatId: string): Promise<void> {
  if (!redisConfigured() || (await isDone(chatId))) return;
  await send(chatId, SURVEY.offer, {
    reply_markup: keyboard([
      [
        { text: SURVEY.go, data: 's:go' },
        { text: SURVEY.later, data: 's:later' },
      ],
    ]),
  });
}

/** /opros или «Давай». Начатый опрос начинается заново. */
export async function startSurvey(chatId: string): Promise<void> {
  if (!redisConfigured()) return;
  if (await isDone(chatId)) {
    await send(chatId, SURVEY.already);
    return;
  }
  await ask(chatId, { step: 0, answers: {}, started_at: new Date().toISOString() });
}

/** /stop — забыть недопройденный опрос. */
export async function cancelSurvey(chatId: string): Promise<void> {
  if (redisConfigured()) await command('DEL', stateKey(chatId));
}

/** Для подсказки «/opros» в ответ на случайные сообщения. */
export const surveyAvailable = async (chatId: string): Promise<boolean> =>
  redisConfigured() && !(await isDone(chatId));

export async function handleSurveyCallback(query: CallbackQuery): Promise<void> {
  const message = query.message;
  const data = query.data ?? '';
  let notice: string | undefined;

  if (message?.chat.type === 'private' && data.startsWith('s:') && redisConfigured()) {
    const chatId = String(message.chat.id);
    await withLock(chatId, async () => {
      if (data === 's:go' || data === 's:later') {
        await removeButtons(chatId, message.message_id);
        if (data === 's:go') await startSurvey(chatId);
        else await send(chatId, SURVEY.laterReply);
        return;
      }

      const [, stepRaw, choice] = data.split(':');
      const step = Number(stepRaw);
      const state = await readState(chatId);
      const options: readonly string[] = QUESTIONS[step]?.options ?? [];
      const answer = choice === '-' ? '' : options[Number(choice)];
      // Кнопки под старыми вопросами уже не действуют
      if (!state || state.step !== step || state.msg !== message.message_id || answer === undefined) {
        notice = SURVEY.stale;
        return;
      }
      await showAnswer(chatId, message.message_id, step, answer || SURVEY.skipped);
      await advance(chatId, state, answer);
    });
  }

  // Без ответа на нажатие у кнопки крутится часик
  await api('answerCallbackQuery', { callback_query_id: query.id, ...(notice ? { text: notice } : {}) }).catch(() => {});
}

/** Ответ своими словами. true — сообщение относилось к опросу и обработано. */
export async function handleSurveyText(chatId: string, text: string): Promise<boolean> {
  if (!redisConfigured()) return false;
  let related = false;
  await withLock(chatId, async () => {
    const state = await readState(chatId);
    if (!state) return;
    related = true;
    if (state.msg) await removeButtons(chatId, state.msg);
    await advance(chatId, state, text.slice(0, 500));
  });
  return related;
}

export async function listSurveyResponses(): Promise<Response[]> {
  const rows = (await hashEntries(RESPONSES_KEY)).map(([, json]) => {
    try {
      return JSON.parse(json) as Response;
    } catch {
      return {};
    }
  });
  return rows.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}
