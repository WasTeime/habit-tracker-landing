import { track } from './analytics';

type State = 'idle' | 'playing' | 'paused';

export function initVideo(): void {
  const root = document.querySelector<HTMLElement>('[data-video]');
  const video = root?.querySelector('video');
  if (!root || !video) return;

  const playButton = root.querySelector<HTMLButtonElement>('[data-video-play]');

  let started = false;
  let startedByViewport = false;
  let pausedByUser = false;
  const progressSent = new Set<number>();

  const setState = (state: State) => {
    root.dataset.state = state;
  };

  const play = (byViewport: boolean) => {
    startedByViewport = byViewport;
    video.play().catch(() => {
      // Автоплей запрещён (энергосбережение, настройки браузера) — показываем кнопку
      setState('paused');
    });
  };

  // Автоплей, когда видео на экране хотя бы наполовину; вне экрана — пауза
  new IntersectionObserver(
    ([entry]) => {
      if (entry.intersectionRatio >= 0.5) {
        if (video.paused && !pausedByUser) play(true);
      } else if (!video.paused) {
        video.pause();
      }
    },
    { threshold: [0, 0.5] },
  ).observe(video);

  video.addEventListener('play', () => {
    setState('playing');
    if (started) return;
    started = true;
    track('video_play', { autoplay: startedByViewport });
  });
  video.addEventListener('pause', () => {
    if (pausedByUser) setState('paused');
  });

  video.addEventListener('timeupdate', () => {
    const { duration, currentTime } = video;
    if (!duration || !Number.isFinite(duration)) return;
    const percent = (currentTime / duration) * 100;
    for (const mark of [25, 50, 75, 100]) {
      // видео зациклено, до ровно 100% timeupdate не доходит
      if (progressSent.has(mark) || percent < (mark === 100 ? 97 : mark)) continue;
      progressSent.add(mark);
      track('video_progress', { percent: mark });
    }
  });

  const togglePlay = () => {
    if (video.paused) {
      pausedByUser = false;
      play(false);
    } else {
      pausedByUser = true;
      video.pause();
    }
  };
  video.addEventListener('click', togglePlay);
  playButton?.addEventListener('click', togglePlay);
}
