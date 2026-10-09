const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Карусель скринов на телефоне: точки показывают, какой скрин ближе к центру, и листают по тапу.
// На десктопе точки скрыты, скрины стоят в ряд
export function initScreens(): void {
  const strip = document.querySelector<HTMLElement>('.screens');
  const dots = [...document.querySelectorAll<HTMLButtonElement>('.screens__dot')];
  if (!strip || !dots.length) return;
  const slides = [...strip.querySelectorAll<HTMLElement>('[data-screen]')];

  // Насколько центр скрина правее середины ленты
  const offset = (slide: HTMLElement) => {
    const rect = slide.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    return rect.left - box.left + rect.width / 2 - strip.clientWidth / 2;
  };

  let frame = 0;
  strip.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const distances = slides.map((slide) => Math.abs(offset(slide)));
        const active = distances.indexOf(Math.min(...distances));
        dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
      });
    },
    { passive: true },
  );

  dots.forEach((dot, i) =>
    dot.addEventListener('click', () => {
      if (!slides[i]) return;
      strip.scrollBy({ left: offset(slides[i]), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }),
  );
}
