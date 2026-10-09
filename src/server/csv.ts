// Выгрузки /api/*.csv. Закрыты паролем WAITLIST_EXPORT_PASSWORD: браузер спросит логин (любой) и пароль.
// Без пароля в настройках адресов как будто нет.
import { timingSafeEqual } from 'node:crypto';
import { getSecret } from 'astro:env/server';

function authorized(header: string | null, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** null — можно отдавать выгрузку; иначе готовый ответ 404 / 401. */
export function exportDenied(request: Request, available: boolean): Response | null {
  const password = getSecret('WAITLIST_EXPORT_PASSWORD');
  if (!password || !available) return new Response('Not found', { status: 404 });
  if (authorized(request.headers.get('authorization'), password)) return null;
  return new Response('Нужен пароль', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="export", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}

// Разделитель «;» и BOM — так файл сразу открывается колонками в русском Excel, кириллица не ломается.
// Google Таблицы разделитель определяют сами
const SEP = ';';

const cell = (value: string | undefined) => {
  const text = value ?? '';
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function csvResponse(name: string, fields: readonly string[], rows: Record<string, string | undefined>[]): Response {
  const lines = [fields.join(SEP), ...rows.map((row) => fields.map((f) => cell(row[f])).join(SEP))];
  const date = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${date}.csv"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
