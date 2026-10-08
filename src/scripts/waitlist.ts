import { COPY } from '../content';
import { abVariant, attribution, device, getDirection, track } from './analytics';

// Та же проверка, что на сервере (src/pages/api/subscribe.ts)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Reason = 'invalid' | 'consent' | 'rate' | 'server' | 'network';

export function initWaitlist(): void {
  const form = document.querySelector<HTMLFormElement>('[data-waitlist]');
  const done = document.querySelector<HTMLElement>('[data-waitlist-done]');
  if (!form || !done) return;

  // Свои сообщения вместо браузерных пузырей; без JS остаётся нативная проверка
  form.noValidate = true;
  const email = form.elements.namedItem('email') as HTMLInputElement;
  const consent = form.elements.namedItem('consent') as HTMLInputElement;
  const trap = form.elements.namedItem('website') as HTMLInputElement;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = form.querySelector<HTMLElement>('[data-waitlist-error]')!;

  let started = false;
  let busy = false;

  // Форма спрятана под «Нет Telegram?» — раскрыли, сразу ставим курсор в поле
  const toggle = form.closest('details');
  toggle?.addEventListener('toggle', () => {
    if (toggle.open) email.focus();
  });

  const clearError = () => {
    error.textContent = '';
    email.removeAttribute('aria-invalid');
    consent.removeAttribute('aria-invalid');
  };

  const showError = (reason: Reason) => {
    clearError();
    const field = reason === 'invalid' ? email : reason === 'consent' ? consent : null;
    error.textContent =
      reason === 'invalid' ? COPY.waitlistInvalid : reason === 'consent' ? COPY.waitlistNoConsent : COPY.waitlistFailed;
    field?.setAttribute('aria-invalid', 'true');
    field?.focus();
    track('waitlist_error', { reason });
  };

  form.addEventListener('focusin', () => {
    if (started) return;
    started = true;
    track('waitlist_start');
  });
  email.addEventListener('input', () => {
    if (email.hasAttribute('aria-invalid')) clearError();
  });
  consent.addEventListener('change', () => {
    if (consent.hasAttribute('aria-invalid')) clearError();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const value = email.value.trim();
    if (value.length > 254 || !EMAIL.test(value)) return showError('invalid');
    if (!consent.checked) return showError('consent');

    busy = true;
    clearError();
    const label = button.textContent;
    button.textContent = COPY.waitlistSending;
    button.setAttribute('aria-busy', 'true');

    let reason: Reason | null = null;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: value,
          consent: true,
          website: trap.value,
          direction: getDirection(),
          device,
          ab: abVariant,
          ...attribution,
        }),
      });
      if (!response.ok) reason = response.status === 400 ? 'invalid' : response.status === 429 ? 'rate' : 'server';
    } catch {
      reason = 'network';
    }

    busy = false;
    button.textContent = label;
    button.removeAttribute('aria-busy');
    if (reason) return showError(reason);

    track('waitlist_signup');
    done.textContent = COPY.waitlistDone.replace('{email}', value);
    form.hidden = true;
    done.hidden = false;
    done.focus({ preventScroll: true });
  });
}
