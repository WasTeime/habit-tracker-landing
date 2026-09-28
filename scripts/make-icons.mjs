// Генерирует public/og.png (1200×630), favicon.svg, favicon.ico, apple-touch-icon.png.
// Запуск: npm run icons. Результат коммитится, на Vercel скрипт не нужен.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = (file) => `${root}public/${file}`;
const fontFile = (subset, weight) =>
  readFileSync(`${root}node_modules/@fontsource/onest/files/onest-${subset}-${weight}-normal.woff`);

const fonts = [800, 700].flatMap((weight) =>
  ['cyrillic', 'latin'].map((subset) => ({ name: subset === 'latin' ? 'OnestLatin' : 'Onest', data: fontFile(subset, weight), weight, style: 'normal' })),
);

const C = {
  bg: '#111827',
  bubble: '#1F2A3C',
  text: '#E8EFF8',
  muted: '#6E8098',
  accent: '#4CAF89',
};

// satori принимает дерево в формате React-элементов
const h = (type, style, ...children) => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

async function render(tree, width, height) {
  const svg = await satori(tree, { width, height, fonts });
  return svg;
}

// ---------- OG ----------
const pose = await sharp(`${root}src/assets/batya-pose-arms.png`).resize(660, 660).png().toBuffer();
const poseUri = `data:image/png;base64,${pose.toString('base64')}`;

const og = h(
  'div',
  {
    display: 'flex',
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: C.bg,
    backgroundImage: `radial-gradient(circle at 78% 62%, ${C.bubble} 0%, ${C.bg} 58%)`,
    fontFamily: 'Onest, OnestLatin',
    color: C.text,
  },
  h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 28,
      width: 660,
      height: '100%',
      paddingLeft: 80,
    },
    h('div', { fontSize: 22, fontWeight: 700, letterSpacing: 2.6, textTransform: 'uppercase', color: C.muted }, 'Батя'),
    h(
      'div',
      { fontSize: 66, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.6 },
      'Давно не можешь прийти к своим целям?',
    ),
    h('div', { fontSize: 36, fontWeight: 700, color: C.accent }, 'Я знаю секрет.'),
  ),
  { type: 'img', props: { src: poseUri, width: 600, height: 600, style: { position: 'absolute', right: -10, bottom: -40 } } },
);

const ogSvg = await render(og, 1200, 630);
await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9, palette: false }).toFile(pub('og.png'));

// ---------- Иконки: «Б» акцентным цветом на фоне страницы ----------
const letter = (size, radius) =>
  h(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      borderRadius: radius,
      backgroundColor: C.bg,
      color: C.accent,
      fontFamily: 'Onest, OnestLatin',
      fontWeight: 800,
      fontSize: size * 0.7,
      lineHeight: 1,
      paddingBottom: size * 0.04,
    },
    'Б',
  );

const faviconSvg = await render(letter(64, 14), 64, 64);
writeFileSync(pub('favicon.svg'), faviconSvg);

// iOS сам скругляет углы — фон в край
const touch = await render(letter(180, 0), 180, 180);
await sharp(Buffer.from(touch)).png().toFile(pub('apple-touch-icon.png'));

// favicon.ico: PNG 32×32 внутри ICO-контейнера (так понимают все браузеры с Vista/IE11)
const png32 = await sharp(Buffer.from(faviconSvg)).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);
entry.writeUInt8(32, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png32.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);
writeFileSync(pub('favicon.ico'), Buffer.concat([header, entry, png32]));

console.log('og.png, favicon.svg, favicon.ico, apple-touch-icon.png → public/');
