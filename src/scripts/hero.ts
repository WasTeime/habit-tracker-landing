// Hero: сначала вопрос выплывает из-за Тренера, только потом «Я знаю» и «секрет».
// Ответ стартует по окончании анимации вопроса, а не по таймеру, — порядок не съедет, даже если кадры тормозят.
// Старт ждёт картинку и шрифт (но не дольше WAIT_MS), чтобы анимация не прошла, пока первый экран грузится
const WAIT_MS = 1200;
// Запас на случай, если animationend так и не придёт: иначе слова остались бы невидимыми.
// Чуть дольше анимации вопроса (1.1 с в global.css), так что и в этом случае ответ идёт после вопроса
const ANSWER_FALLBACK_MS = 1500;

export function initHero(): void {
  const hero = document.querySelector<HTMLElement>('.hero');
  const question = hero?.querySelector('.hero__q');
  if (!hero || !question) return;

  const answer = () => (hero.dataset.play = 'answer');
  question.addEventListener('animationend', answer, { once: true });

  const font = getComputedStyle(hero).getPropertyValue('--font-hero');
  const ready = Promise.all([
    hero.querySelector('img')?.decode().catch(() => undefined),
    document.fonts?.load(`700 1em ${font}`, 'Я?').catch(() => undefined),
  ]);
  const timeout = new Promise((resolve) => window.setTimeout(resolve, WAIT_MS));
  void Promise.race([ready, timeout]).then(() => {
    hero.dataset.play = 'question';
    window.setTimeout(answer, ANSWER_FALLBACK_MS);
  });
}
