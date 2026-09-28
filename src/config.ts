// Все настройки — через переменные окружения (Vercel → Settings → Environment Variables).
// Пустое значение = функция выключена. Шаблон — в .env.example.
const env = import.meta.env;

export type ConsentMode = 'notice' | 'opt-in';

export const CONFIG = {
  store: {
    // App Store: числовой id из ссылки apps.apple.com/app/id<ID>
    appStoreId: env.PUBLIC_APPSTORE_ID ?? '',
    // App Store Connect → App Analytics → Campaigns: provider token (pt)
    appStoreProviderToken: env.PUBLIC_APPSTORE_PT ?? '',
    // Google Play: имя пакета, например ru.batya.app
    googlePlayId: env.PUBLIC_GOOGLE_PLAY_ID ?? '',
    // Смарт-ссылка MMP (AppsFlyer OneLink / Adjust / Branch). Если пусто — используется свой /go
    smartLink: env.PUBLIC_SMART_LINK ?? '',
  },
  analytics: {
    metrikaId: env.PUBLIC_YM_ID ?? '',
    posthogKey: env.PUBLIC_POSTHOG_KEY ?? '',
    posthogHost: env.PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
    metaPixelId: env.PUBLIC_META_PIXEL_ID ?? '',
    tiktokPixelId: env.PUBLIC_TIKTOK_PIXEL_ID ?? '',
    vkPixelId: env.PUBLIC_VK_PIXEL_ID ?? '',
  },
  // notice — аналитика стартует сразу, баннер только уведомляет (типично для РФ).
  // opt-in — Метрика, PostHog и пиксели ждут согласия (нужно при трафике из ЕС).
  consentMode: (env.PUBLIC_CONSENT_MODE === 'opt-in' ? 'opt-in' : 'notice') as ConsentMode,
  privacyUrl: env.PUBLIC_PRIVACY_URL ?? '',
};
