import type { APIRoute } from 'astro';
import { redisConfigured } from '../../server/redis';
import { readAttribution, saveTgRef, tooManyAttempts } from '../../server/waitlist';

export const prerender = false;

// Клик по кнопке «в Telegram»: запоминаем utm и направление под коротким ref,
// бот достанет их по /start <ref>. Ответ клиенту не важен — он уже уходит в Telegram.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const done = new Response(null, { status: 204 });
  if (!redisConfigured()) return done;

  const data = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ref = typeof data?.ref === 'string' ? data.ref : '';
  if (!data || !/^[A-Za-z0-9]{8,32}$/.test(ref)) return new Response(null, { status: 400 });

  let ip: string | undefined;
  try {
    ip = clientAddress;
  } catch {
    ip = undefined;
  }
  if (await tooManyAttempts(ip)) return done;

  try {
    await saveTgRef(ref, readAttribution(data));
  } catch (error) {
    console.error('[tg-ref]', error);
  }
  return done;
};
