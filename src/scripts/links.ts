import { CONFIG } from '../config';

export type Store = 'ios' | 'android';
export type Attribution = Record<string, string>;

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
// yclid — Директ, fbclid — Meta, ttclid — TikTok, rb_clickid — VK Ads, gclid — Google Ads
export const CLICK_ID_KEYS = ['yclid', 'fbclid', 'ttclid', 'rb_clickid', 'gclid'] as const;

// Направление из демо уходит отдельным параметром, а не в utm_content:
// utm_content уже занят креативом, и перезаписать его — потерять атрибуцию установки к объявлению.
export const DIRECTION_PARAM = 'direction';

export function pickAttribution(params: URLSearchParams): Attribution {
  const out: Attribution = {};
  for (const key of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 200);
  }
  return out;
}

// App Store Connect принимает campaign token до 40 символов
function campaignToken(attr: Attribution): string {
  return (attr.utm_campaign || attr.utm_source || 'landing').slice(0, 40);
}

/** Прямая ссылка на стор с атрибуцией. Пустая строка — стор не настроен. */
export function storeUrl(store: Store, attr: Attribution, direction?: string | null): string {
  const { appStoreId, appStoreProviderToken, googlePlayId } = CONFIG.store;

  if (store === 'android') {
    if (!googlePlayId) return '';
    // Install Referrer API в приложении получит эту строку целиком
    const referrer = new URLSearchParams();
    for (const key of UTM_KEYS) if (attr[key]) referrer.set(key, attr[key]);
    if (!referrer.has('utm_source')) referrer.set('utm_source', 'landing');
    if (!referrer.has('utm_medium')) referrer.set('utm_medium', 'web');
    if (attr.gclid) referrer.set('gclid', attr.gclid);
    if (direction) referrer.set(DIRECTION_PARAM, direction);

    const url = new URL('https://play.google.com/store/apps/details');
    url.searchParams.set('id', googlePlayId);
    url.searchParams.set('referrer', referrer.toString());
    return url.toString();
  }

  if (!appStoreId) return '';
  const url = new URL(`https://apps.apple.com/app/id${appStoreId}`);
  if (appStoreProviderToken) {
    url.searchParams.set('pt', appStoreProviderToken);
    url.searchParams.set('ct', campaignToken(attr));
  }
  url.searchParams.set('mt', '8');
  return url.toString();
}

interface SmartUrlOptions {
  /** Для QR: click id привязаны к устройству, где был клик, на телефоне они бесполезны и раздувают код */
  withClickIds?: boolean;
}

/**
 * Ссылка, которая сама разводит по сторам: смарт-ссылка MMP, если задана, иначе свой /go.
 */
export function smartUrl(
  attr: Attribution,
  direction: string | null | undefined,
  origin: string,
  { withClickIds = true }: SmartUrlOptions = {},
): string {
  const smart = CONFIG.store.smartLink;
  const url = new URL(smart || '/go', origin);
  const keys = withClickIds ? [...UTM_KEYS, ...CLICK_ID_KEYS] : UTM_KEYS;
  for (const key of keys) if (attr[key]) url.searchParams.set(key, attr[key]);

  if (smart && /\.onelink\.me$/i.test(url.hostname)) {
    // AppsFlyer читает свои параметры, utm_* для атрибуции не использует
    if (attr.utm_source) url.searchParams.set('pid', attr.utm_source);
    if (attr.utm_campaign) url.searchParams.set('c', attr.utm_campaign);
    if (attr.utm_content) url.searchParams.set('af_ad', attr.utm_content);
    if (attr.utm_term) url.searchParams.set('af_keywords', attr.utm_term);
  }

  if (direction) {
    url.searchParams.set(DIRECTION_PARAM, direction);
    // deferred deep link: приложение откроет онбординг с этим направлением
    if (smart) url.searchParams.set('deep_link_value', direction);
  }
  return url.toString();
}
