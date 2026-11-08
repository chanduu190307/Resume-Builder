/**
 * End-to-end export checks: render real PDF and DOCX files and read the text
 * back the way a parser would. Every visible field must survive, for every
 * fixture and every template.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import { Packer } from "docx";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDocument } from "../document/buildDocument.ts";
import { TEMPLATE_LIST } from "../document/templates.ts";
import { FIXTURE_FILES, FONT_DIR, loadFixture } from "../../test/fixtures.ts";
import { expectedText, squash } from "../../test/visibleText.ts";
import { buildDocx } from "./docx.ts";
import { preparePdfFonts } from "./fonts.ts";
import { ResumePdf } from "./ResumePdf.tsx";

beforeAll(() => preparePdfFonts(FONT_DIR));

// Case-insensitive: some templates print headings in capitals ("EXPERIENCE").
const norm = (text: string) => squash(text).toLowerCase();

async function pdfText(buffer: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocument({ data: buffer, useSystemFonts: false }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
  }
  return { text: lines.join("\n"), pages: pdf.numPages };
}

/** Every ToUnicode CMap in the PDF (decompressed). */
function toUnicodeCMaps(buffer: Uint8Array): string[] {
  const buf = Buffer.from(buffer);
  const raw = buf.toString("latin1");
  const maps: string[] = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    let data: Buffer = buf.subarray(start, end);
    if (/FlateDecode/.test(m[1]!)) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    const text = data.toString("latin1");
    if (text.includes("begincmap")) maps.push(text);
  }
  return maps;
}

async function docxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml
    .split("</w:p>")
    .map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
        .map((m) => (m[0] === "<w:tab/>" ? "\t" : m[1]!))
        .join(""),
    )
    .map((p) => p.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join("\n");
}

const cases = FIXTURE_FILES.flatMap((file) => TEMPLATE_LIST.map((t) => [file, t.id] as const));

describe("PDF export", () => {
  it.each(cases)("%s [%s]: every visible field is extractable text", async (file, template) => {
    const resume = loadFixture(file);
    resume.meta.template = template;
    const buffer = await renderToBuffer(<ResumePdf doc={buildDocument(resume)} />);
    const { text, pages } = await pdfText(new Uint8Array(buffer));
    const flat = norm(text);
    const { visible, hidden } = expectedText(resume);
    expect(visible.filter((v) => !flat.includes(norm(v)))).toEqual([]);
    expect(hidden.filter((h) => flat.includes(norm(h)))).toEqual([]);
    expect(pages).toBeLessThanOrEqual(2);
    // Line wrapping must never insert characters: a line may only end in "-" if the user typed it there.
    const source = JSON.stringify(resume);
    const insertedHyphens = text
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.endsWith("-"))
      .map((l) => l.split(" ").pop()!)
      .filter((word) => !source.includes(word));
    expect(insertedHyphens).toEqual([]);
    // Every glyph must map back to real characters, or parsers read garbage.
    const cmaps = toUnicodeCMaps(new Uint8Array(buffer));
    expect(cmaps.length).toBeGreaterThan(0);
    expect(cmaps.filter((c) => c.includes("<>"))).toEqual([]);
  });

  it("regression: text stays extractable after many renders in one session", async () => {
    // Before the fontkit glyph-cache fix, rendering fixture 01 first made "B.S."
    // in fixture 02 extract as "#s#" (empty ToUnicode entries).
    for (const template of TEMPLATE_LIST) {
      const first = loadFixture(FIXTURE_FILES[0]!);
      first.meta.template = template.id;
      await renderToBuffer(<ResumePdf doc={buildDocument(first)} />);
    }
    const second = loadFixture(FIXTURE_FILES.find((f) => f.startsWith("02"))!);
    second.meta.template = "modern";
    const buffer = await renderToBuffer(<ResumePdf doc={buildDocument(second)} />);
    expect((await pdfText(new Uint8Array(buffer))).text).toContain("B.S., Computer Science");
  });
});

describe("page size", () => {
  it.each([
    ["A4", 595.28, 841.89],
    ["Letter", 612, 792],
  ] as const)("%s pages have the right dimensions", async (size, width, height) => {
    const resume = loadFixture(FIXTURE_FILES[0]!);
    resume.meta.page_size = size;
    const buffer = await renderToBuffer(<ResumePdf doc={buildDocument(resume)} />);
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const [, , w, h] = (await pdf.getPage(1)).view;
    expect(w).toBeCloseTo(width, 0);
    expect(h).toBeCloseTo(height, 0);
  });
});

describe("DOCX export", () => {
  it("uses real Word tabs for right-aligned dates (a tab character inside text is not a tab in Word)", async () => {
    const resume = loadFixture(FIXTURE_FILES.find((f) => f.startsWith("02"))!);
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocx(buildDocument(resume))));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:tab/>");
    expect(xml).not.toMatch(/<w:t(?:\s[^>]*)?>[^<]*\t/);
  });

  it.each(cases)("%s [%s]: every visible field is present", async (file, template) => {
    const resume = loadFixture(file);
    resume.meta.template = template;
    const buffer = await Packer.toBuffer(buildDocx(buildDocument(resume)));
    const flat = norm(await docxText(buffer));
    const { visible, hidden } = expectedText(resume);
    expect(visible.filter((v) => !flat.includes(norm(v)))).toEqual([]);
    expect(hidden.filter((h) => flat.includes(norm(h)))).toEqual([]);
  });
});
