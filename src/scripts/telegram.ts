import { CONFIG } from '../config';
import { abVariant, attribution, device, getDirection, track } from './analytics';

// В ссылку на бота влезает только 64 символа из [A-Za-z0-9_-], поэтому utm туда не кладём:
// по клику они уходят на /api/tg-ref под случайным ref, а бот достаёт их по /start <направление>_<ref>.
// Направление дублируется прямо в ссылке — оно доедет, даже если запрос с метками потеряется.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function makeRef(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export function initTelegram(): void {
  const link = document.querySelector<HTMLAnchorElement>('[data-tg]');
  if (!link) return;
  const hint = document.querySelector<HTMLElement>('[data-tg-done]');
  const bot = CONFIG.telegramBot;
  const ref = makeRef();

  const startParam = () => {
    const direction = getDirection();
    return direction ? `${direction}_${ref}` : ref;
  };
  // Ссылку держим актуальной заранее — чтобы и «открыть в новой вкладке» / «копировать» вели с метками
  const update = () => {
    if (bot) link.href = `https://t.me/${bot}?start=${startParam()}`;
  };
  update();
  document.addEventListener('batya:direction', update);

  link.addEventListener('click', (e) => {
    if (!bot) {
      e.preventDefault();
      console.warn('[waitlist] не задан PUBLIC_TELEGRAM_BOT');
      return;
    }
    update();
    track('tg_click');
    // keepalive — запрос доживёт, даже если браузер уйдёт в приложение Telegram
    void fetch('/api/tg-ref', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, direction: getDirection(), device, ab: abVariant, ...attribution }),
    }).catch(() => {});
    if (hint) hint.hidden = false;
  });
}
