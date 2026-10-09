import type { APIRoute } from 'astro';
import { csvResponse, exportDenied } from '../../server/csv';
import { redisConfigured } from '../../server/redis';
import { listSurveyResponses, SURVEY_FIELDS } from '../../server/survey';

export const prerender = false;

// Ответы кастдев-опроса из бота. Пароль — см. src/server/csv.ts
export const GET: APIRoute = async ({ request }) =>
  exportDenied(request, redisConfigured()) ?? csvResponse('survey', SURVEY_FIELDS, await listSurveyResponses());
