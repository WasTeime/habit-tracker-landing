import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { CSV_FIELDS, exportAvailable, listSubscribers } from '../../server/waitlist';

export const prerender = false;

// Выгрузка листа ожидания из Redis (Telegram и почта, колонка channel).
// Открыть /api/waitlist.csv, браузер спросит логин и пароль.
// Логин любой, пароль — WAITLIST_EXPORT_PASSWORD. Без пароля в настройках адреса как будто нет.

function authorized(header: string | null, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const cell = (value: string | undefined) => {
  const text = value ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const GET: APIRoute = async ({ request }) => {
  const password = getSecret('WAITLIST_EXPORT_PASSWORD');
  if (!password || !exportAvailable()) return new Response('Not found', { status: 404 });

  if (!authorized(request.headers.get('authorization'), password)) {
    return new Response('Нужен пароль', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="waitlist", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }

  const rows = await listSubscribers();
  const csv = [CSV_FIELDS.join(','), ...rows.map((row) => CSV_FIELDS.map((f) => cell(row[f])).join(','))].join('\r\n');
  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="waitlist-${date}.csv"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
};
