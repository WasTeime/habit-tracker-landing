import { CONFIG } from '../config';
import { initAnalytics } from './analytics';
import { initConsent } from './consent';
import { initCta } from './cta';
import { initDemo } from './demo';
import { initDialog } from './dialog';
import { initEngagement } from './engagement';
import { initHero } from './hero';
import { initScreens } from './screens';
import { initTelegram } from './telegram';
import { initVideo } from './video';
import { initWaitlist } from './waitlist';

initHero();
initAnalytics();
initConsent();
if (CONFIG.ctaMode === 'waitlist') {
  initTelegram();
  initWaitlist();
} else initCta();
initDialog();
initDemo();
initScreens();
initVideo();
initEngagement();
