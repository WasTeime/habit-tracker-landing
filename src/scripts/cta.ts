import { CONFIG } from '../config';
import { attribution, device, getDirection, track, trackThenNavigate } from './analytics';
import { smartUrl, storeUrl, type Store } from './links';

const isPlainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

async function qrSvg(text: string): Promise<string> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
}

function initQrDialog(dialog: HTMLDialogElement): () => void {
  const box = dialog.querySelector<HTMLElement>('[data-qr-code]');

  dialog.querySelector('[data-qr-close]')?.addEventListener('click', () => dialog.close());
  // Клик по подложке. Внутри диалога всё накрыто обёрткой, так что target === dialog только снаружи
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  return () => {
    const url = smartUrl(attribution, getDirection(), location.origin, { withClickIds: false });
    dialog.showModal();
    track('qr_shown');
    if (!box || box.dataset.url === url) return;
    box.dataset.url = url;
    qrSvg(url)
      .then((svg) => {
        box.innerHTML = svg;
      })
      .catch(() => {
        box.textContent = 'Не получилось нарисовать код — нажми на бейдж стора ниже';
      });
  };
}

export function initCta(): void {
  const main = document.querySelector<HTMLAnchorElement>('[data-cta-main]');
  const badges = document.querySelectorAll<HTMLAnchorElement>('[data-store]');
  const dialog = document.querySelector<HTMLDialogElement>('[data-qr]');
  const openQr = dialog && device === 'desktop' ? initQrDialog(dialog) : null;
  const hasSmartLink = Boolean(CONFIG.store.smartLink);
  const origin = location.origin;

  const mainHref = () => {
    const direction = getDirection();
    if (device === 'desktop' || hasSmartLink) return smartUrl(attribution, direction, origin);
    return storeUrl(device, attribution, direction) || smartUrl(attribution, direction, origin);
  };

  const badgeHref = (store: Store) => {
    const direction = getDirection();
    // На телефоне смарт-ссылка даёт атрибуцию установки; на десктопе нужна просто страница приложения
    if (device !== 'desktop' && hasSmartLink) return smartUrl(attribution, direction, origin);
    return storeUrl(store, attribution, direction) || '#';
  };

  const refresh = () => {
    if (main) main.href = mainHref();
    badges.forEach((badge) => {
      badge.href = badgeHref(badge.dataset.store as Store);
    });
  };

  badges.forEach((badge) => {
    // На телефоне показываем только стор своей ОС
    if (device !== 'desktop' && badge.dataset.store !== device) badge.hidden = true;
    // С десктопа стор открываем в новой вкладке, чтобы лендинг не терялся
    if (device === 'desktop') {
      badge.target = '_blank';
      badge.rel = 'noopener';
    }
  });
  refresh();
  document.addEventListener('batya:direction', refresh);

  main?.addEventListener('click', (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (openQr) {
      track('cta_click', { position: 'final' });
      openQr();
      return;
    }
    trackThenNavigate('cta_click', { position: 'final' }, main.href);
  });

  badges.forEach((badge) =>
    badge.addEventListener('click', (e) => {
      const store = badge.dataset.store!;
      const configured = badge.getAttribute('href') !== '#';
      if (!configured) e.preventDefault();
      if (!configured || device === 'desktop' || !isPlainClick(e)) {
        track('store_click', { store });
        return;
      }
      e.preventDefault();
      trackThenNavigate('store_click', { store }, badge.href);
    }),
  );
}
