import { detectDevice } from './device';
import { DIRECTION_PARAM, pickAttribution, storeUrl, type Store } from './links';

// /go — своя «смарт-ссылка» без MMP: сюда ведёт QR с десктопа, а телефон отсюда уходит в нужный стор
const params = new URLSearchParams(location.search);
const attribution = pickAttribution(params);
const direction = params.get(DIRECTION_PARAM);
const device = detectDevice();

document.querySelectorAll<HTMLAnchorElement>('[data-store]').forEach((link) => {
  link.href = storeUrl(link.dataset.store as Store, attribution, direction) || '#';
});

const target = device === 'desktop' ? '' : storeUrl(device, attribution, direction);
if (target) location.replace(target);
else document.documentElement.dataset.choose = '';
