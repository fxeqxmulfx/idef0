/** Finding font files on disk, for the Node API and the command line. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Model } from './model.ts';
import { needsUnicodeFont, type FontFiles } from './pdf.ts';

export interface FontOptions {
  /** TrueType/OpenType font for all text. Overrides the model's `font` setting. */
  font?: string;
  /** Bold variant of `font`; found automatically next to it when it follows the usual naming. */
  boldFont?: string;
  /** Folder that a relative `font` setting in the model is relative to, usually the model file's. */
  baseDir?: string;
}

/** Unicode fonts tried when the model has text the built-in Helvetica can't encode. */
const UNICODE_FONTS: [string, string][] = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf'],
];

/**
 * The fonts to embed for a model: the font asked for, else a Unicode font found on the system
 * when the text needs one, else none (the PDF then uses the built-in Helvetica).
 */
export function findFonts(model: Model, options: FontOptions = {}): FontFiles | undefined {
  const custom = options.font ?? (model.meta.font && options.baseDir ? resolve(options.baseDir, model.meta.font) : model.meta.font);
  if (custom) {
    if (!existsSync(custom)) throw new Error(`font file not found: ${custom}`);
    const guess = custom.replace(/(-Regular)?(\.[ot]tf)$/i, '-Bold$2');
    return { regular: custom, bold: options.boldFont ?? (guess !== custom && existsSync(guess) ? guess : custom) };
  }
  if (!needsUnicodeFont(model)) return undefined;
  const found = UNICODE_FONTS.find(([r]) => existsSync(r));
  if (!found) {
    throw new Error(
      'the model contains characters the built-in PDF fonts cannot show, and no Unicode font was found; pass one with --font path/to/font.ttf (or `font "path"` in the model)',
    );
  }
  return { regular: found[0], bold: existsSync(found[1]) ? found[1] : found[0] };
}
