// Upstash Redis через REST (Vercel → Storage → Upstash for Redis). Только для сервера.
import { getSecret } from 'astro:env/server';

function redisConfig() {
  const url = getSecret('KV_REST_API_URL') || getSecret('UPSTASH_REDIS_REST_URL');
  const token = getSecret('KV_REST_API_TOKEN') || getSecret('UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export type RedisReply = { result?: unknown; error?: string };

export const redisConfigured = (): boolean => Boolean(redisConfig());

export async function redis(path: '' | '/pipeline', body: unknown): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error('redis is not configured');
  const response = await fetch(config.url + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`redis: HTTP ${response.status}`);
  return response.json();
}

export async function command(...args: string[]): Promise<unknown> {
  const reply = (await redis('', args)) as RedisReply;
  if (reply.error) throw new Error(`redis: ${reply.error}`);
  return reply.result;
}

/** HGETALL в REST-API Upstash — плоский массив [поле, значение, поле, значение, …] */
export async function hashEntries(key: string): Promise<[string, string][]> {
  const flat = ((await command('HGETALL', key)) as string[] | null) ?? [];
  const entries: [string, string][] = [];
  for (let i = 1; i < flat.length; i += 2) entries.push([flat[i - 1], flat[i]]);
  return entries;
}
