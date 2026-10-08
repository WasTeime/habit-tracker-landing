// Хранилище листа ожидания. Только для сервера: секреты читаются в рантайме.
// Два канала:
//  - Telegram (основной) — chat_id подписчиков бота в Upstash Redis, на релизе рассылка через бота;
//  - почта (запасной, выключена флагом PUBLIC_WAITLIST_EMAIL) — Redis и/или UniSender.
import { createHash } from 'node:crypto';
import { getSecret } from 'astro:env/server';
import { DIRECTIONS } from '../content';
import { command, hashEntries, redis, redisConfigured, type RedisReply } from './redis';

export const ATTRIBUTION_FIELDS = [
  'direction',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'device',
  'ab',
] as const;

export const CSV_FIELDS = ['channel', 'email', 'telegram_id', 'created_at', ...ATTRIBUTION_FIELDS] as const;

export type Attribution = Partial<Record<(typeof ATTRIBUTION_FIELDS)[number], string>>;
export type Subscriber = Attribution & { email: string; created_at: string };
export type TgSubscriber = Attribution & { telegram_id: string; created_at: string };
export type CsvRow = Partial<Record<(typeof CSV_FIELDS)[number], string>>;

const EMAIL_KEY = 'batya:waitlist';
const TG_KEY = 'batya:tg';
const TG_REF_PREFIX = 'batya:tgref:';
const TG_REF_TTL = 7 * 24 * 3600; // от клика на лендинге до «Запустить» в боте обычно минуты
const RATE_LIMIT = 30; // запросов с одного IP в час; мобильные операторы сажают много людей на один IP

const DIRECTION_IDS = new Set<string>(DIRECTIONS.map((d) => d.id));

const short = (value: unknown, max = 100): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : undefined;
};

export const validDirection = (value: unknown): string | undefined => {
  const id = short(value, 20);
  return id && DIRECTION_IDS.has(id) ? id : undefined;
};

/** Направление, utm, устройство и A/B из тела запроса — только известные поля, обрезанные. */
export function readAttribution(data: Record<string, unknown>): Attribution {
  const out: Attribution = {};
  for (const key of ATTRIBUTION_FIELDS) {
    const value = key === 'direction' ? validDirection(data[key]) : short(data[key]);
    if (value) out[key] = value;
  }
  return out;
}

// ---------- UniSender ----------

function unisenderConfig() {
  const apiKey = getSecret('UNISENDER_API_KEY');
  const listId = getSecret('UNISENDER_LIST_ID');
  return apiKey && listId ? { apiKey, listId } : null;
}

async function toUnisender(config: { apiKey: string; listId: string }, sub: Subscriber): Promise<void> {
  const body = new URLSearchParams({
    format: 'json',
    api_key: config.apiKey,
    list_ids: config.listId,
    'fields[email]': sub.email,
    // Согласие собрано галочкой на лендинге — письмо-подтверждение не шлём
    double_optin: '3',
    tags: ['waitlist', sub.direction].filter(Boolean).join(','),
  });
  const response = await fetch('https://api.unisender.com/ru/api/subscribe', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(8000),
  });
  const reply = (await response.json().catch(() => ({}))) as RedisReply;
  if (!response.ok || reply.error) throw new Error(`unisender: ${reply.error ?? `HTTP ${response.status}`}`);
}

// ---------- почта ----------

export const storageConfigured = (): boolean => Boolean(redisConfigured() || unisenderConfig());
export const exportAvailable = (): boolean => redisConfigured();

/** Сохраняет везде, где подключено. Ошибка — только если не сохранилось нигде. */
export async function saveSubscriber(sub: Subscriber): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  // HSETNX: повторная заявка не перетирает первую (дату и источник)
  if (redisConfigured()) jobs.push(command('HSETNX', EMAIL_KEY, sub.email, JSON.stringify(sub)));
  const unisender = unisenderConfig();
  if (unisender) jobs.push(toUnisender(unisender, sub));

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const failure of failed) console.error('[waitlist]', failure.reason);
  if (!results.length || failed.length === results.length) throw new Error('waitlist: not saved');
}

// ---------- Telegram ----------

// Метки клика живут в Redis под коротким ключом: в ссылку на бота влезает только 64 символа
export async function saveTgRef(ref: string, attribution: Attribution): Promise<void> {
  await command('SET', TG_REF_PREFIX + ref, JSON.stringify(attribution), 'EX', String(TG_REF_TTL));
}

export async function readTgRef(ref: string): Promise<Attribution> {
  try {
    const raw = (await command('GET', TG_REF_PREFIX + ref)) as string | null;
    return raw ? readAttribution(JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (error) {
    console.error('[waitlist] tg ref', error);
    return {};
  }
}

/** true — новый подписчик; повторный /start не перетирает дату и источник. */
export async function addTgSubscriber(sub: TgSubscriber): Promise<boolean> {
  return Number(await command('HSETNX', TG_KEY, sub.telegram_id, JSON.stringify(sub))) === 1;
}

export async function removeTgSubscriber(telegramId: string): Promise<void> {
  await command('HDEL', TG_KEY, telegramId);
}

export async function countTgSubscribers(): Promise<number> {
  return Number(await command('HLEN', TG_KEY));
}

// ---------- общее ----------

/** Простой лимит по IP. IP не храним — только короткий хеш на час. При сбое не блокируем. */
export async function tooManyAttempts(ip: string | undefined): Promise<boolean> {
  if (!ip || !redisConfigured()) return false;
  const key = `batya:rl:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
  try {
    const replies = (await redis('/pipeline', [
      ['SET', key, '0', 'EX', '3600', 'NX'],
      ['INCR', key],
    ])) as RedisReply[];
    return Number(replies[1]?.result) > RATE_LIMIT;
  } catch (error) {
    console.error('[waitlist] rate limit', error);
    return false;
  }
}

function parseRows(entries: [string, string][], channel: string, idField: 'email' | 'telegram_id'): CsvRow[] {
  return entries.map(([id, json]) => {
    try {
      return { ...(JSON.parse(json) as CsvRow), channel, [idField]: id };
    } catch {
      return { channel, [idField]: id, created_at: '' };
    }
  });
}

/** Оба канала одним списком для выгрузки CSV. */
export async function listSubscribers(): Promise<CsvRow[]> {
  const [tg, email] = await Promise.all([hashEntries(TG_KEY), hashEntries(EMAIL_KEY)]);
  return [...parseRows(tg, 'telegram', 'telegram_id'), ...parseRows(email, 'email', 'email')].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
}
