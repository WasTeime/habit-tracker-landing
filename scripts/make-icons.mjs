// Генерирует public/og.png (1200×630), favicon.ico, icon-192.png, apple-touch-icon.png.
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
    h('div', { fontSize: 22, fontWeight: 700, letterSpacing: 2.6, textTransform: 'uppercase', color: C.muted }, 'Тренер'),
    h(
      'div',
      { fontSize: 66, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.6 },
      'Давно не можешь прийти к своим целям?',
    ),
    h('div', { fontSize: 36, fontWeight: 700, color: C.accent }, 'Я знаю секрет'),
  ),
  { type: 'img', props: { src: poseUri, width: 600, height: 600, style: { position: 'absolute', right: -10, bottom: -40 } } },
);

const ogSvg = await render(og, 1200, 630);
await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9, palette: false }).toFile(pub('og.png'));

// ---------- Иконки: лицо Тренера из src/assets/batya-wave.webp ----------
// Кадр — голова целиком: на вкладке иконка 16–32 px, фигура там не читается
const FACE = { left: 330, top: 60, width: 470, height: 470 };
// Палитра: мультяшной картинке хватает, а весит в разы меньше
const PNG = { compressionLevel: 9, palette: true, quality: 90 };
const face = (size) => sharp(`${root}src/assets/batya-wave.webp`).extract(FACE).resize(size, size).png(PNG);

async function rounded(size, radius) {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
  return face(size).composite([{ input: mask, blend: 'dest-in' }]).png(PNG).toBuffer();
}

// iOS сам скругляет углы — фото в край
await face(180).toFile(pub('apple-touch-icon.png'));
// Android / Chrome берут крупную PNG
writeFileSync(pub('icon-192.png'), await rounded(192, 42));

// favicon.ico: PNG 16, 32 и 48 внутри ICO-контейнера (так понимают все браузеры с Vista/IE11)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => rounded(size, Math.round(size * 0.22))));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(images[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return entry;
});
writeFileSync(pub('favicon.ico'), Buffer.concat([header, ...entries, ...images]));

console.log('og.png, favicon.ico, icon-192.png, apple-touch-icon.png → public/');
