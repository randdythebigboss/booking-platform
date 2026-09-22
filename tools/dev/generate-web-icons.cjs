/**
 * Generates the web application icons from the native ones.
 *
 *   node tools/dev/generate-web-icons.cjs
 *
 * Run this when `assets/images/icon.png` or the Android adaptive pair changes.
 * The output is committed, so a normal build and CI never run this.
 *
 * ---------------------------------------------------------------------------
 * Why the two kinds of icon are not interchangeable
 * ---------------------------------------------------------------------------
 *
 * A manifest icon marked `any` is drawn literally -- in the install prompt, in
 * the task switcher, and on an iOS home screen, where transparency composites
 * onto black rather than onto the page. It has to be opaque and full bleed.
 *
 * An icon marked `maskable` is cropped by the launcher to whatever shape the
 * platform likes -- circle, squircle, rounded square -- so its corners must be
 * filled and its logo must sit inside the middle 80%.
 *
 * Android's adaptive `foreground` is the second kind: a small logo on
 * transparency. Using it for `any` is the mistake this script exists to stop
 * from coming back -- it produces a black square with a little glyph in it.
 */
const fs = require('fs');
const { PNG } = require('pngjs');

const read = (path) => PNG.sync.read(fs.readFileSync(path));

/**
 * Area-average downscale: each destination pixel is the weighted mean of the
 * source region it covers. Handles fractional factors (1024 -> 192) without
 * the aliasing that picking nearest neighbours would produce on a fine grid.
 */
function downscale(src, size) {
  const scale = src.width / size;
  const out = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y++) {
    const top = y * scale;
    const bottom = (y + 1) * scale;

    for (let x = 0; x < size; x++) {
      const left = x * scale;
      const right = (x + 1) * scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;

      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);

        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const weight = wy * (Math.min(right, sx + 1) - Math.max(left, sx));
          const i = (src.width * sy + sx) * 4;
          // Premultiply, so a transparent pixel does not drag whatever colour
          // it happens to carry into the average.
          const alpha = src.data[i + 3] / 255;

          r += src.data[i] * alpha * weight;
          g += src.data[i + 1] * alpha * weight;
          b += src.data[i + 2] * alpha * weight;
          a += src.data[i + 3] * weight;
          total += weight;
        }
      }

      const alpha = a / total;
      const undo = alpha === 0 ? 0 : 255 / alpha;
      const o = (size * y + x) * 4;

      out.data[o] = Math.round(Math.min(255, (r / total) * undo));
      out.data[o + 1] = Math.round(Math.min(255, (g / total) * undo));
      out.data[o + 2] = Math.round(Math.min(255, (b / total) * undo));
      out.data[o + 3] = Math.round(alpha);
    }
  }

  return out;
}

/** Composites onto a solid colour and drops the alpha channel entirely. */
function flatten(image, [br, bg, bb]) {
  const out = new PNG({ width: image.width, height: image.height });

  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3] / 255;
    out.data[i] = Math.round(image.data[i] * a + br * (1 - a));
    out.data[i + 1] = Math.round(image.data[i + 1] * a + bg * (1 - a));
    out.data[i + 2] = Math.round(image.data[i + 2] * a + bb * (1 - a));
    out.data[i + 3] = 255;
  }

  return out;
}

function write(path, image) {
  // colorType 2 is RGB with no alpha: these are all opaque, and carrying a
  // pointless alpha channel is what made the old 1024 icon 799 KB.
  fs.writeFileSync(path, PNG.sync.write(image, { deflateLevel: 9, colorType: 2 }));
  console.log(`${path}  ${image.width}x${image.height}  ${Math.round(fs.statSync(path).size / 1024)} KB`);
}

const appIcon = read('assets/images/icon.png');
const foreground = read('assets/images/android-icon-foreground.png');

// White, because the manifest's background_color is white: an icon and the
// surface it is drawn on should not disagree about what is behind the artwork.
// The app icon is opaque anyway, so this only ever matters at the edges.
const BEHIND_APP_ICON = [255, 255, 255];

// The pale blue the Android adaptive background is made of. Deliberately the
// colour and not the file: `android-icon-background.png` is the Expo
// template's *design guide* -- 97% flat, and the other 3% is construction
// circles and dashed axes that have no business on somebody's home screen.
const BEHIND_MASKABLE = [230, 244, 254];

write('public/icons/icon-192.png', flatten(downscale(appIcon, 192), BEHIND_APP_ICON));
write('public/icons/icon-512.png', flatten(downscale(appIcon, 512), BEHIND_APP_ICON));
write('public/icons/icon-maskable-512.png', flatten(foreground, BEHIND_MASKABLE));
