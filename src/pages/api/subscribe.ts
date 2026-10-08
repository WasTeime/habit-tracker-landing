import type { APIRoute } from 'astro';
import { CONFIG } from '../../config';
import { COPY } from '../../content';
import { readAttribution, saveSubscriber, storageConfigured, tooManyAttempts, type Subscriber } from '../../server/waitlist';

export const prerender = false;

// Та же проверка, что на клиенте (src/scripts/waitlist.ts)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ErrorCode = 'bad_request' | 'invalid_email' | 'no_consent' | 'rate_limited' | 'unavailable';

const PAGE_ERRORS: Partial<Record<ErrorCode, string>> = {
  invalid_email: COPY.waitlistInvalid,
  no_consent: COPY.waitlistNoConsent,
};

async function readBody(request: Request): Promise<{ data: Record<string, unknown> | null; isJson: boolean }> {
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  try {
    const data = isJson ? await request.json() : Object.fromEntries(await request.formData());
    return { data: data && typeof data === 'object' ? (data as Record<string, unknown>) : null, isJson };
  } catch {
    return { data: null, isJson };
  }
}

// Без JS форма отправляется обычным POST — отвечаем страницей, а не JSON
function page(text: string, status: number): Response {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Батя</title>
<body style="margin:0;background:#111827;color:#e8eff8;font:18px/1.5 system-ui,sans-serif"><main style="max-width:480px;margin:0 auto;padding:64px 20px">
<p style="margin:0 0 24px">${text}</p><a href="/" style="color:#4caf89">← Вернуться</a></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Форма почты выключена (PUBLIC_WAITLIST_EMAIL) — не принимаем почту и прямым запросом
  if (!CONFIG.waitlistEmail) return new Response('Not found', { status: 404 });

  const { data, isJson } = await readBody(request);

  const ok = (email: string) =>
    isJson ? Response.json({ ok: true }) : page(escapeHtml(COPY.waitlistDone.replace('{email}', email)), 200);
  const fail = (status: number, error: ErrorCode) => {
    if (isJson) return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
    return page(PAGE_ERRORS[error] ?? COPY.waitlistFailed, status);
  };

  if (!data) return fail(400, 'bad_request');

  const email = String(data.email ?? '').trim().toLowerCase();
  // Ловушка для ботов: человек это поле не видит. Отвечаем «успехом», чтобы бот не подбирал обход
  if (String(data.website ?? '').trim()) return ok(email);
  if (email.length > 254 || !EMAIL.test(email)) return fail(400, 'invalid_email');
  if (data.consent !== true && data.consent !== 'on' && data.consent !== '1') return fail(400, 'no_consent');

  let ip: string | undefined;
  try {
    ip = clientAddress;
  } catch {
    ip = undefined;
  }
  if (await tooManyAttempts(ip)) return fail(429, 'rate_limited');

  const sub: Subscriber = {
    ...readAttribution(data),
    email,
    // Галочка согласия обязательна, так что дата заявки = дата согласия
    created_at: new Date().toISOString(),
  };

  if (!storageConfigured()) {
    if (import.meta.env.DEV) {
      console.info('[waitlist] хранилище не подключено, заявка только в консоли:', sub);
      return ok(email);
    }
    console.error('[waitlist] не подключено хранилище: задайте KV_REST_API_* или UNISENDER_*');
    return fail(503, 'unavailable');
  }

  try {
    await saveSubscriber(sub);
  } catch {
    return fail(502, 'unavailable');
  }
  return ok(email);
};
