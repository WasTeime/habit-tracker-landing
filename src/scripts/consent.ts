import { CONFIG } from '../config';
import { getConsent, hasTrackers, setConsent } from './analytics';

export function initConsent(): void {
  const banner = document.querySelector<HTMLElement>('[data-consent]');
  if (!banner || !hasTrackers || getConsent()) return;

  banner.hidden = false;
  const close = () => {
    banner.hidden = true;
  };

  banner.querySelector('[data-consent-accept]')?.addEventListener('click', () => {
    setConsent(CONFIG.consentMode === 'opt-in' ? 'granted' : 'ack');
    close();
  });
  banner.querySelector('[data-consent-decline]')?.addEventListener('click', () => {
    setConsent('denied');
    close();
  });
}
