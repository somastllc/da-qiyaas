// Replace legacy header wordmark in recorded demo assets (logo image only).
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { GifFrame, GifUtil, GifCodec } = require('gifwrap');

const ROOT = path.resolve(__dirname, '../..');
const LOGO = { x: 40, y: 33, w: 120, h: 34 };
const DARK_FROM_MS = 3340;
const LIGHT_BG = '#fafafa';
const DARK_BG = '#101210';
const logoLight = path.join(ROOT, 'frontend/public/brand/somast-wordmark-teal.svg');
const logoDark = path.join(ROOT, 'frontend/public/brand/somast-wordmark-dark.svg');

function scaledBox(width) {
  const scale = width / 1280;
  return {
    x: Math.round(LOGO.x * scale),
    y: Math.round(LOGO.y * scale),
    w: Math.round(LOGO.w * scale),
    h: Math.round(LOGO.h * scale),
  };
}

async function rasterLogo(svgPath, box) {
  return sharp(svgPath).resize(box.w, box.h).png().toBuffer();
}

async function patchRaster(inputBuffer, width, height, dark) {
  const box = scaledBox(width);
  const bg = dark ? DARK_BG : LIGHT_BG;
  const logo = dark ? await rasterLogo(logoDark, box) : await rasterLogo(logoLight, box);
  const fill = await sharp({
    create: { width: box.w, height: box.h, channels: 3, background: bg },
  })
    .png()
    .toBuffer();
  return sharp(inputBuffer)
    .composite([{ input: fill, top: box.y, left: box.x }, { input: logo, top: box.y, left: box.x }])
    .png()
    .toBuffer();
}

async function patchPng(file, dark) {
  const input = path.join(ROOT, file);
  const meta = await sharp(input).metadata();
  const buf = await patchRaster(fs.readFileSync(input), meta.width, meta.height, dark);
  await sharp(buf).toFile(input);
}

function darkFrameIndex(frames) {
  let at = 0;
  for (let index = 0; index < frames.length; index++) {
    if (at >= DARK_FROM_MS) return index;
    at += frames[index].delayCentisecs * 10;
  }
  return frames.length;
}

async function patchGif() {
  const gifPath = path.join(ROOT, 'docs/assets/demo.gif');
  const decoded = await GifUtil.read(fs.readFileSync(gifPath));
  const darkFrom = darkFrameIndex(decoded.frames);
  const frames = [];
  for (let index = 0; index < decoded.frames.length; index++) {
    const frame = decoded.frames[index];
    const dark = index >= darkFrom;
    const png = await sharp(frame.bitmap.data, {
      raw: { width: frame.bitmap.width, height: frame.bitmap.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const patched = await patchRaster(png, frame.bitmap.width, frame.bitmap.height, dark);
    const bitmap = await sharp(patched).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push(
      new GifFrame(
        { width: bitmap.info.width, height: bitmap.info.height, data: bitmap.data },
        { delayCentisecs: frame.delayCentisecs, disposalMethod: frame.disposalMethod },
      ),
    );
  }
  GifUtil.quantizeDekker(frames, 128);
  const codec = new GifCodec();
  fs.writeFileSync(gifPath, (await codec.encodeGif(frames, { loops: 0 })).buffer);
}

(async () => {
  await patchPng('docs/assets/overview.png', false);
  await patchPng('docs/assets/dark-result.png', true);
  await patchGif();
  console.log('patched demo assets');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
