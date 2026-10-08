import { COPY, DIRECTIONS } from '../content';
import { setDirection, track } from './analytics';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Подтягиваем новую реплику в кадр, если она ушла под нижний край экрана
function reveal(el: Element | null): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= window.innerHeight - 16) return;
  el.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function line(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'line anim';
  p.textContent = text;
  return p;
}

export function initDemo(): void {
  const chips = document.querySelectorAll<HTMLButtonElement>('[data-direction]');
  const output = document.querySelector<HTMLElement>('[data-demo-reply]');
  const template = document.querySelector<HTMLTemplateElement>('#tpl-demo-reply');
  const cta = document.querySelector('[data-cta-main], [data-tg], [data-waitlist]');
  if (!output || !template) return;

  let current: string | null = null;
  let timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  const pick = (id: string) => {
    const dir = DIRECTIONS.find((d) => d.id === id);
    if (!dir || id === current) return;
    current = id;

    // Другой выбор заменяет ответ, историю не копим
    timers.forEach(clearTimeout);
    timers = [];
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.direction === id)));

    setDirection(id);
    track('direction_click', { direction: id });

    const fragment = template.content.cloneNode(true) as DocumentFragment;
    fragment.querySelector('[data-slot="label"]')!.textContent = dir.label;
    const batya = fragment.querySelector<HTMLElement>('[data-slot="batya"]')!;
    const body = batya.querySelector<HTMLElement>('[data-slot="body"]')!;
    const typing = batya.querySelector<HTMLElement>('[data-slot="typing"]')!;
    output.replaceChildren(fragment);

    const typingMs = 700 + Math.round(Math.random() * 300);
    later(250, () => {
      batya.hidden = false;
      reveal(batya);
    });
    later(250 + typingMs, () => {
      typing.replaceWith(line(dir.reply));
    });
    later(250 + typingMs + 400, () => {
      body.append(line(COPY.restInApp));
      reveal(cta);
    });
  };

  chips.forEach((chip) => chip.addEventListener('click', () => pick(chip.dataset.direction!)));
}
