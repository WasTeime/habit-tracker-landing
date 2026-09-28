# Лендинг «Батя»

Одностраничный лендинг под платный трафик: десктоп — вариант **4a**, мобильный (< 1024px) — **1c**. Сделан по handoff из `design_handoff_landing/README.md`.

**Стек:** Astro 7 (статическая сборка) + обычный CSS + немного TypeScript на клиенте. Шрифт Onest раздаётся с нашего домена (`@fontsource/onest`), картинки жмутся при сборке в AVIF/WebP. JS на странице ~14 КБ; PostHog и генератор QR подгружаются, только когда нужны.

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # → dist/
npm run check     # проверка типов
```

## Деплой на Vercel

1. Залить папку в репозиторий GitHub/GitLab → Vercel → **Add New Project** → импортировать. Фреймворк Astro определится сам, настройки сборки менять не нужно (`vercel.json` уже в проекте).
   Или без репозитория: `npx vercel` из папки проекта.
2. **Settings → Environment Variables** — заполнить переменные из `.env.example` (минимум: ID сторов и Метрики). После изменения переменных — **Redeploy**.
3. **Analytics → Enable** (Web Analytics) и **Speed Insights → Enable** — код уже подключён, без включения в панели данные просто не собираются.
4. Свой домен: **Settings → Domains**. `og:image` и `canonical` возьмут домен продакшена сами; если нужен другой — `PUBLIC_SITE_URL`.

## Что положить до запуска

| Что | Куда | Примечание |
|---|---|---|
| 3 скрина приложения | `src/assets/screens/1.png`, `2.png`, `3.png` | Порядок по имени: путь привычек, детали привычки, чат. Оригинальный размер скрина iPhone подходит, ужмётся при сборке |
| Видео 30 сек | `public/media/batya-demo.mp4` | H.264, 1280×720, в пределах 5–8 МБ. Стартует без звука, звук включается кнопкой. По желанию ещё `batya-demo.webm` |
| Постер видео | `public/media/batya-demo-poster.jpg` (или `.webp`) | Первый кадр, 1280×720 |
| Официальные бейджи | `public/badges/app-store.svg`, `google-play.svg` | Скачать с Apple Marketing Tools и Google Play Badges; подхватятся вместо текстовых кнопок |
| Политика обработки ПДн | ссылка в `PUBLIC_PRIVACY_URL` | Нужна по 152-ФЗ, баннер на неё ссылается |

Пока файлов нет, на месте скринов и видео — пустые слоты, как в макете. Ничего в коде менять не надо, достаточно положить файлы и пересобрать.

`og.png` (1200×630), `favicon.svg/ico`, `apple-touch-icon.png` уже лежат в `public/`. Перегенерировать: `npm run icons` (скрипт `scripts/make-icons.mjs`).

## Переменные окружения

| Переменная | Что это |
|---|---|
| `PUBLIC_APPSTORE_ID` | числовой id из `apps.apple.com/app/id…` |
| `PUBLIC_APPSTORE_PT` | provider token из App Store Connect → App Analytics → Campaigns; без него `ct` не пишется |
| `PUBLIC_GOOGLE_PLAY_ID` | имя пакета |
| `PUBLIC_SMART_LINK` | OneLink / Adjust / Branch. Пусто — работает свой `/go` |
| `PUBLIC_YM_ID` | номер счётчика Метрики |
| `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` | PostHog, по желанию |
| `PUBLIC_META_PIXEL_ID`, `PUBLIC_TIKTOK_PIXEL_ID`, `PUBLIC_VK_PIXEL_ID` | пиксели — только куда реально идёт трафик |
| `PUBLIC_CONSENT_MODE` | `notice` (по умолчанию) или `opt-in` |
| `PUBLIC_PRIVACY_URL` | ссылка на политику |
| `PUBLIC_SITE_URL` | адрес сайта, если не домен продакшена Vercel |

Пустая переменная = функция выключена.

## Ссылки на стор

- **Телефон:** главная кнопка и бейдж ведут прямо в стор своей ОС (или в смарт-ссылку, если задана). Показывается только бейдж текущей ОС.
- **Десктоп:** главная кнопка открывает модалку с QR-кодом + бейджи обоих сторов (открываются в новой вкладке).
- **`/go`** — своя «смарт-ссылка» без MMP. На неё ведёт QR, если `PUBLIC_SMART_LINK` пуст: телефон сразу уходит в свой стор, десктоп видит выбор.
- **Google Play** получает `referrer` с `utm_*` и направлением — приложение читает его через Install Referrer API.
- **App Store** получает `pt` + `ct` (кампания, до 40 символов) — видно в App Store Connect → App Analytics.
- **OneLink:** если смарт-ссылка на `*.onelink.me`, UTM дублируются в параметры AppsFlyer (`pid`, `c`, `af_ad`, `af_keywords`), направление — в `deep_link_value`.

**Направление из демо** уходит параметром `direction=<sport|money|focus|health>`, а не в `utm_content`, как было в handoff. Причина: `utm_content` уже несёт креатив, и если его перезаписать, установка теряет привязку к объявлению. Приложению нужно читать `direction` (из referrer на Android и из `deep_link_value` / параметров смарт-ссылки). Имя параметра — одна константа `DIRECTION_PARAM` в `src/scripts/links.ts`.

UTM и click id (`yclid`, `fbclid`, `ttclid`, `rb_clickid`, `gclid`) сохраняются в `sessionStorage` при заходе и дописываются во все ссылки на стор.

## Аналитика

Все события идут через одну функцию `track()` в `src/scripts/analytics.ts`, к каждому автоматически добавляются `utm_*`, click id, `device` (ios/android/desktop), `variant` (desktop_4a / mobile_1c), `ab` и `direction` (если выбрано).

| Событие | Когда | Параметры |
|---|---|---|
| `page_view` | загрузка | referrer |
| `scroll_depth` | 25 / 50 / 75 / 100% | depth |
| `section_view` | секция ≥ 50% в кадре впервые | section: hero, screens, video, demo, cta |
| `screenshot_view` | скрин в кадре / свайп | index |
| `video_play` | первый старт | autoplay |
| `video_progress` | 25 / 50 / 75 / 100% | percent |
| `video_unmute` | включил звук | — |
| `direction_click` | выбор направления | direction |
| `cta_click` | главная кнопка | position: final |
| `store_click` | бейдж стора | store: ios / android |
| `qr_shown` | модалка с QR | — |
| `time_on_page` | 15 / 30 / 60 с активного времени | seconds |

Куда уходит:

- **Яндекс Метрика** — все события как цели `reachGoal`, `page_view` — в параметры визита. `section_view` уходит целями `section_view_hero`, `section_view_screens` и т. д. (Метрика не умеет фильтровать цель по параметру, а для воронки нужны отдельные шаги). Вебвизор, карта кликов, точный показатель отказов включены в коде; карту скроллинга включить в настройках счётчика.
  В интерфейсе Метрики создать цели типа «JavaScript-событие» с идентификаторами: `direction_click`, `cta_click`, `store_click`, `qr_shown`, `section_view_screens`, `section_view_demo` (+ остальные по желанию). Воронка из handoff — составная цель: `section_view_screens` → `section_view_demo` → `direction_click` → `store_click`.
- **PostHog** — все события, `page_view` как `$pageview`. Воронки строятся по `section_view` с фильтром по `section`.
- **Пиксели** (Meta / TikTok / VK) — только `direction_click`, `cta_click`, `store_click`, `qr_shown` + просмотр страницы.
- **Vercel Web Analytics** — просмотры, источники, страны, устройства на любом плане. Кастомные события (те же четыре) Vercel принимает только на Pro; на Hobby они просто не сохраняются.

Сторонние скрипты грузятся после `load`, чтобы не мешать первому экрану. Переход в стор ждёт отправки цели не дольше 300 мс.

**Отладка:** на `localhost` или с `?debug_analytics` в адресе каждое событие пишется в консоль.

### Согласие на cookie

Баннер появляется, только если подключено что-то с cookie (Метрика, PostHog, пиксели); Vercel Analytics работает без cookie.

- `PUBLIC_CONSENT_MODE=notice` — аналитика стартует сразу, баннер уведомляет («Понятно»). Типичная практика для РФ.
- `PUBLIC_CONSENT_MODE=opt-in` — Метрика, PostHog и пиксели ждут «Принять». Нужно, если есть трафик из ЕС.

Какой режим нужен по 152-ФЗ именно вам — вопрос к юристу; код поддерживает оба.

## A/B

Заголовок первого экрана и текст главной кнопки подменяются вариантом из `AB_VARIANTS` в `src/content.ts`:

```ts
export const AB_VARIANTS = {
  b: { heroTitle: '…', ctaMain: '…' },
};
```

Ссылка `?v=b` включает вариант (он запоминается на сессию), ключ уходит во все события параметром `ab`. Подменить можно любой элемент с атрибутом `data-copy`. Для раскатки через PostHog feature flags — читать флаг и класть его значение в тот же механизм.

## Структура

```
src/
  content.ts          копия, направления, A/B-варианты, мета
  config.ts           переменные окружения
  pages/index.astro   страница
  pages/go.astro      редирект в стор
  components/         Hero, Turn (реплика), Screens, DemoVideo, Cta, StoreBadges, QrDialog, Consent
  scripts/            analytics, links (ссылки на стор), demo (чат), video, cta (+QR), engagement (скролл/секции/время), consent
  styles/global.css   токены и вся вёрстка; мобильная и десктопная раскладки — два медиазапроса
public/               og.png, иконки, media/ для видео, badges/ для бейджей
scripts/make-icons.mjs
```

## Что добавлено сверх макета

Тексты, которых не было в handoff, — проверить и поправить при необходимости:

- модалка QR: «Наведи камеру телефона» / «Откроется App Store или Google Play — там и продолжим.»;
- баннер cookie;
- страница `/go`: «Открываю магазин приложений…» / «Выбери свой магазин».

Поведение, которого не было в макете: выбранная чипса остаётся залитой; после ответа Бати страница мягко доводит до кнопки, если она ниже экрана; видео зациклено, ставится на паузу вне экрана, первое включение звука начинает ролик сначала.
