import { track } from './analytics';

export function initEngagement(): void {
  scrollDepth();
  sectionViews();
  screenshotViews();
  activeTime();
}

function scrollDepth(): void {
  const marks = [25, 50, 75, 100];
  const sent = new Set<number>();
  let scheduled = false;

  const check = () => {
    scheduled = false;
    const seen = ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100;
    for (const mark of marks) {
      if (sent.has(mark) || seen < (mark === 100 ? 99 : mark)) continue;
      sent.add(mark);
      track('scroll_depth', { depth: mark });
    }
    if (sent.size === marks.length) window.removeEventListener('scroll', onScroll);
  };
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(check);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(check);
}

function sectionViews(): void {
  const seen = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const section = el.dataset.trackSection!;
        if (!entry.isIntersecting || seen.has(section)) continue;
        // Секция выше половины экрана никогда не будет видна на 50% — тогда считаем по доле экрана
        const fillsHalfScreen = entry.intersectionRect.height >= window.innerHeight * 0.5;
        if (entry.intersectionRatio < 0.5 && !fillsHalfScreen) continue;
        seen.add(section);
        observer.unobserve(el);
        track('section_view', { section });
      }
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  document.querySelectorAll<HTMLElement>('[data-track-section]').forEach((el) => observer.observe(el));
}

function screenshotViews(): void {
  // Клиппинг горизонтального скролла на мобилке учитывается, так что свайп тоже ловится
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        track('screenshot_view', { index: Number(el.dataset.screen) });
      }
    },
    { threshold: 0.6 },
  );
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach((el) => observer.observe(el));
}

function activeTime(): void {
  const marks = [15, 30, 60];
  const idleAfterMs = 30_000;
  let seconds = 0;
  let lastActivity = Date.now();

  const bump = () => {
    lastActivity = Date.now();
  };
  for (const type of ['scroll', 'wheel', 'pointerdown', 'pointermove', 'keydown', 'touchstart']) {
    window.addEventListener(type, bump, { passive: true });
  }

  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const video = document.querySelector('video');
    const watching = Boolean(video && !video.paused);
    if (!watching && Date.now() - lastActivity > idleAfterMs) return;

    seconds += 1;
    if (marks.includes(seconds)) track('time_on_page', { seconds });
    if (seconds >= marks[marks.length - 1]) window.clearInterval(timer);
  }, 1000);
}
