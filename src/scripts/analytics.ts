import { track as vercelTrack } from '@vercel/analytics';
import { CONFIG } from '../config';
import { detectDevice, type Device } from './device';
import { pickAttribution, type Attribution } from './links';

type Value = string | number | boolean;
export type Params = Record<string, Value | null | undefined>;
export type Consent = 'granted' | 'denied' | 'ack';

type Fn = (...args: unknown[]) => void;
type Queued = Fn & { a?: unknown[]; l?: number };

declare global {
  interface Window {
    ym?: Queued;
    fbq?: Fn & { callMethod?: Fn; queue?: unknown[]; push?: Fn; loaded?: boolean; version?: string };
    _fbq?: unknown;
    ttq?: { track: Fn; page: Fn; load: (id: string) => void };
    _tmr?: unknown[];
    __ab?: { id: string; copy: Record<string, string> };
  }
}

const ATTR_KEY = 'batya:attr';
const CONSENT_KEY = 'batya:consent';

const { metrikaId, posthogKey, posthogHost, metaPixelId, tiktokPixelId, vkPixelId } = CONFIG.analytics;

export const hasTrackers = Boolean(metrikaId || posthogKey || metaPixelId || tiktokPixelId || vkPixelId);

// Эти события уходят ещё и в пиксели и Vercel; скролл, время и видео — только в Метрику и PostHog
const CONVERSION_EVENTS = new Set(['direction_click', 'cta_click', 'store_click', 'qr_shown']);

const debug = location.hostname === 'localhost' || location.search.includes('debug_analytics');

function read(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function write(kind: 'local' | 'session', key: string, value: string): void {
  try {
    (kind === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    // приватный режим / заблокированные данные сайта — живём без сохранения
  }
}

function loadAttribution(): Attribution {
  const fresh = pickAttribution(new URLSearchParams(location.search));
  if (Object.keys(fresh).length) {
    write('session', ATTR_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    return JSON.parse(read('session', ATTR_KEY) || '{}') as Attribution;
  } catch {
    return {};
  }
}

export const device: Device = detectDevice();
export const attribution: Attribution = loadAttribution();
export const abVariant: string = window.__ab?.id ?? 'default';

const desktopQuery = matchMedia('(min-width: 1024px)');
export const layoutVariant = (): string => (desktopQuery.matches ? 'desktop_4a' : 'mobile_1c');

let direction: string | null = null;
export const getDirection = (): string | null => direction;
export function setDirection(id: string): void {
  direction = id;
  document.dispatchEvent(new CustomEvent('batya:direction', { detail: id }));
}

type PosthogLike = {
  capture: (name: string, props?: Record<string, unknown>, options?: Record<string, unknown>) => void;
};
let posthog: PosthogLike | null = null;
const posthogQueue: [string, Record<string, Value>][] = [];

function payload(params: Params): Record<string, Value> {
  const merged: Params = {
    ...attribution,
    device,
    variant: layoutVariant(),
    ab: abVariant,
    direction,
    ...params,
  };
  const out: Record<string, Value> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

export function track(name: string, params: Params = {}, onSent?: () => void): void {
  const data = payload(params);
  if (debug) console.info('[track]', name, data);

  if (metrikaId && window.ym) {
    // page_view — это хит, его Метрика шлёт сама; параметры кладём в параметры визита.
    // Цель в Метрике не фильтруется по параметру, поэтому секции — отдельными целями для воронки.
    const goal = name === 'section_view' ? `section_view_${params.section}` : name;
    if (name === 'page_view') window.ym(Number(metrikaId), 'params', data);
    else window.ym(Number(metrikaId), 'reachGoal', goal, data, onSent);
  }

  if (posthogKey) {
    const event = name === 'page_view' ? '$pageview' : name;
    if (posthog) posthog.capture(event, data, { send_instantly: true, transport: 'sendBeacon' });
    else posthogQueue.push([event, data]);
  }

  if (!CONVERSION_EVENTS.has(name)) return;

  window.fbq?.('trackCustom', name, data);
  window.ttq?.track(name, data);
  if (vkPixelId && window._tmr) window._tmr.push({ type: 'reachGoal', id: vkPixelId, goal: name });

  // Vercel принимает мало свойств на событие (и только на платных планах) — шлём главное
  const short: Record<string, Value> = {};
  for (const key of ['direction', 'store', 'position'] as const) if (data[key] !== undefined) short[key] = data[key];
  vercelTrack(name, short);
}

/** Для переходов в стор: даём событию уйти, но не держим человека дольше 300 мс. */
export function trackThenNavigate(name: string, params: Params, url: string): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    location.href = url;
  };
  track(name, params, go);
  window.setTimeout(go, vendorsLoaded && metrikaId ? 300 : 120);
}

// ---------- загрузка сторонних скриптов ----------

function injectScript(src: string): void {
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.append(script);
}

function afterLoad(fn: () => void): void {
  const run = () => window.setTimeout(fn, 0);
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

function stubMetrika(): void {
  // Очередь вызовов до загрузки tag.js — как в официальном сниппете
  const ym: Queued = function (...args: unknown[]) {
    (ym.a = ym.a || []).push(args);
  };
  ym.l = Date.now();
  window.ym = window.ym || ym;
  window.ym(Number(metrikaId), 'init', {
    webvisor: true,
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
  });
}

function loadMetaPixel(id: string): void {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as NonNullable<Window['fbq']>;
  window.fbq = fbq;
  window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  injectScript('https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', id);
  fbq('track', 'PageView');
}

function loadTiktokPixel(id: string): void {
  if (window.ttq) return;
  // Официальный сниппет TikTok в развёрнутом виде: очередь вызовов до загрузки events.js
  const w = window as any;
  w.TiktokAnalyticsObject = 'ttq';
  const ttq: any = (w.ttq = []);
  const methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
  const defer = (target: any, method: string) => {
    target[method] = (...args: unknown[]) => target.push([method, ...args]);
  };
  for (const method of methods) defer(ttq, method);
  ttq.instance = (name: string) => {
    const inst = ttq._i[name] || [];
    for (const method of methods) defer(inst, method);
    return inst;
  };
  ttq.load = (sdkId: string, options?: object) => {
    const src = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i = ttq._i || {};
    ttq._i[sdkId] = [];
    ttq._i[sdkId]._u = src;
    ttq._t = ttq._t || {};
    ttq._t[sdkId] = Date.now();
    ttq._o = ttq._o || {};
    ttq._o[sdkId] = options || {};
    injectScript(`${src}?sdkid=${sdkId}&lib=ttq`);
  };
  ttq.load(id);
  ttq.page();
}

function loadVkPixel(id: string): void {
  const tmr = (window._tmr = window._tmr || []);
  tmr.push({ id, type: 'pageView', start: Date.now() });
  injectScript('https://top-fwz1.mail.ru/js/code.js');
}

async function loadPosthog(): Promise<void> {
  try {
    const { default: ph } = await import('posthog-js');
    ph.init(posthogKey, {
      api_host: posthogHost,
      capture_pageview: false,
      person_profiles: 'identified_only',
    });
    posthog = ph as unknown as PosthogLike;
    for (const [event, data] of posthogQueue.splice(0)) posthog.capture(event, data);
  } catch (error) {
    if (debug) console.warn('[analytics] posthog failed', error);
  }
}

let vendorsLoaded = false;
function loadVendors(): void {
  if (vendorsLoaded) return;
  vendorsLoaded = true;
  if (metrikaId) injectScript('https://mc.yandex.ru/metrika/tag.js');
  if (posthogKey) void loadPosthog();
  if (metaPixelId) loadMetaPixel(metaPixelId);
  if (tiktokPixelId) loadTiktokPixel(tiktokPixelId);
  if (vkPixelId) loadVkPixel(vkPixelId);
}

// ---------- согласие ----------

export function getConsent(): Consent | null {
  const value = read('local', CONSENT_KEY);
  return value === 'granted' || value === 'denied' || value === 'ack' ? value : null;
}

export function setConsent(value: Consent): void {
  write('local', CONSENT_KEY, value);
  if (value !== 'denied') afterLoad(loadVendors);
}

export function initAnalytics(): void {
  if (metrikaId) stubMetrika();
  track('page_view', { referrer: document.referrer.slice(0, 300) || undefined });

  const consent = getConsent();
  const allowed = CONFIG.consentMode === 'notice' ? consent !== 'denied' : consent === 'granted';
  // После load, чтобы сторонние скрипты не конкурировали с первым экраном за сеть
  if (allowed) afterLoad(loadVendors);
}
