import { track } from './analytics';

// Разговор по шагам: сначала видно только первую реплику Тренера и кнопку с ответом.
// После клика реплики идут по очереди, перед репликой Тренера — «печатает…».
// Шаг с data-after-pick (кнопка Telegram) ждёт выбора направления — его показывает demo.ts, без «печатает…»:
// подпись над кнопкой — не реплика Тренера.
// Без JS (класс .js не встал) всё видно сразу, кнопки нет
export const PAUSE_MS = 600;
const YOU_PAUSE_MS = 1000;
const TYPING_MS = 1000;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Подтягиваем новую реплику в кадр, если она ушла под нижний край экрана
export function reveal(el: Element | null): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= window.innerHeight - 16) return;
  el.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function typing(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'typing';
  el.innerHTML =
    '<span class="typing__dot"></span>'.repeat(3) + '<span class="sr-only">Тренер печатает…</span>';
  return el;
}

export function show(turn: HTMLElement): void {
  if (turn.dataset.shown !== undefined) return reveal(turn);
  turn.classList.add('anim');
  turn.dataset.shown = '';
  reveal(turn);
}

/** Реплика Тренера: сначала «печатает…», потом текст. Уже показанную только подтягивает в кадр */
export async function say(turn: HTMLElement): Promise<void> {
  if (turn.dataset.shown !== undefined) return reveal(turn);
  const body = turn.querySelector<HTMLElement>('.turn__body')!;
  const dots = typing();
  body.prepend(dots);
  body.dataset.typing = '';
  show(turn);

  await wait(TYPING_MS + Math.round(Math.random() * 300));
  dots.remove();
  delete body.dataset.typing;
  body.classList.add('anim');
  reveal(turn);
}

export function initDialog(): void {
  const ask = document.querySelector<HTMLElement>('[data-ask]');
  const button = ask?.querySelector('button');
  const steps = [...document.querySelectorAll<HTMLElement>('[data-step]:not([data-after-pick])')];
  if (!ask || !button || !steps.length) return;

  button.addEventListener(
    'click',
    async () => {
      track('dialog_start');
      ask.hidden = true;

      for (const [i, step] of steps.entries()) {
        if (step.classList.contains('turn--you')) {
          if (i > 0) await wait(YOU_PAUSE_MS);
          show(step);
          // Кнопка пропала — фокус на её месте, чтобы клавиатура и скринридер не улетали в начало
          if (i === 0) step.focus({ preventScroll: true });
        } else {
          await wait(PAUSE_MS);
          await say(step);
        }
      }
    },
    { once: true },
  );
}
