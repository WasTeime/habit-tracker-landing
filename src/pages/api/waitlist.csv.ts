import type { APIRoute } from 'astro';
import { csvResponse, exportDenied } from '../../server/csv';
import { CSV_FIELDS, exportAvailable, listSubscribers } from '../../server/waitlist';

export const prerender = false;

// Лист ожидания из Redis: Telegram и почта, колонка channel. Пароль — см. src/server/csv.ts
export const GET: APIRoute = async ({ request }) =>
  exportDenied(request, exportAvailable()) ?? csvResponse('waitlist', CSV_FIELDS, await listSubscribers());
