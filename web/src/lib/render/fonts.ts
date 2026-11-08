import { Font } from "@react-pdf/renderer";

const FAMILIES = ["Carlito", "Caladea"] as const;
const VARIANTS = [
  { file: "Regular", fontWeight: 400, fontStyle: "normal" },
  { file: "Bold", fontWeight: 700, fontStyle: "normal" },
  { file: "Italic", fontWeight: 400, fontStyle: "italic" },
  { file: "BoldItalic", fontWeight: 700, fontStyle: "italic" },
] as const;

let registeredBase: string | null = null;

/**
 * Registers the embedded PDF fonts. `base` is "/fonts" in the browser, or an
 * absolute directory path in tests.
 */
export function registerPdfFonts(base: string): void {
  if (registeredBase === base) return;
  for (const family of FAMILIES) {
    Font.register({
      family,
      fonts: VARIANTS.map((v) => ({
        src: `${base}/${family}-${v.file}.ttf`,
        fontWeight: v.fontWeight,
        fontStyle: v.fontStyle,
      })),
    });
  }
  // react-pdf hyphenates long words by default ("develop-" / "ment"). Hyphenated
  // words break keyword matching in ATS parsers, so never split words.
  Font.registerHyphenationCallback((word) => [word]);
  registeredBase = base;
}

interface FontkitGlyph {
  codePoints: number[];
}

interface FontkitFont {
  getGlyph(id: number, characters?: number[]): FontkitGlyph;
  __resumeBuilderPatched?: boolean;
}

/**
 * Works around a text-extraction bug in fontkit/react-pdf (found by our export tests).
 *
 * fontkit caches glyph objects by id, keeping the characters from the *first*
 * request. When a PDF is finalised, fontkit's subsetter fetches the component
 * glyphs of composite glyphs with no characters, so those glyphs get cached with
 * empty `codePoints`. The next PDF that uses one of them as real text writes an
 * empty ToUnicode entry, and parsers (ATS) read garbage, e.g. "B.S." -> "#s#".
 *
 * The patch fills in missing characters whenever a later request supplies them.
 */
function patchGlyphCache(font: FontkitFont | null | undefined): void {
  if (!font || font.__resumeBuilderPatched) return;
  const original = font.getGlyph.bind(font);
  font.getGlyph = (id, characters = []) => {
    const glyph = original(id, characters);
    if (characters.length > 0 && glyph.codePoints.length === 0) glyph.codePoints = characters;
    return glyph;
  };
  font.__resumeBuilderPatched = true;
}

/** Registers, loads and patches every font variant. Call before each render. */
export async function preparePdfFonts(base: string): Promise<void> {
  registerPdfFonts(base);
  for (const family of FAMILIES) {
    for (const v of VARIANTS) {
      const descriptor = { fontFamily: family, fontWeight: v.fontWeight, fontStyle: v.fontStyle };
      await Font.load(descriptor);
      const source = (Font as unknown as { getFont(d: typeof descriptor): { data: FontkitFont | null } }).getFont(descriptor);
      patchGlyphCache(source.data);
    }
  }
}
