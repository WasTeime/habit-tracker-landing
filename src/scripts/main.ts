import { CONFIG } from '../config';
import { initAnalytics } from './analytics';
import { initConsent } from './consent';
import { initCta } from './cta';
import { initDemo } from './demo';
import { initEngagement } from './engagement';
import { initTelegram } from './telegram';
import { initVideo } from './video';
import { initWaitlist } from './waitlist';

initAnalytics();
initConsent();
if (CONFIG.ctaMode === 'waitlist') {
  initTelegram();
  initWaitlist();
} else initCta();
initDemo();
initVideo();
initEngagement();
