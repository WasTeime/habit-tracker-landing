// Hero: сначала вопрос выплывает из-за Тренера, только потом «Я знаю» и «секрет».
// Ответ стартует по окончании анимации вопроса, а не по таймеру, — порядок не съедет, даже если кадры тормозят.
// Старт ждёт картинку и шрифт (но не дольше WAIT_MS), чтобы анимация не прошла, пока первый экран грузится
const WAIT_MS = 1200;

export function initHero(): void {
  const hero = document.querySelector<HTMLElement>('.hero');
  const question = hero?.querySelector('.hero__q');
  if (!hero || !question) return;

  question.addEventListener('animationend', () => (hero.dataset.play = 'answer'), { once: true });

  const font = getComputedStyle(hero).getPropertyValue('--font-hero');
  const ready = Promise.all([
    hero.querySelector('img')?.decode().catch(() => undefined),
    document.fonts?.load(`700 1em ${font}`, 'Я?').catch(() => undefined),
  ]);
  const timeout = new Promise((resolve) => window.setTimeout(resolve, WAIT_MS));
  void Promise.race([ready, timeout]).then(() => (hero.dataset.play = 'question'));
}
