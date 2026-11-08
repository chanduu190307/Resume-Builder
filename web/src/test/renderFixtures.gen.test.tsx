/**
 * Generator (not a regular test): renders every golden fixture into the files
 * the engine's import-accuracy tests read, in fixtures/rendered/.
 *
 *   npm run gen:rendered
 *
 * Variants per fixture:
 *   <name>.<template>.pdf / .docx   our three templates
 *   <name>.paste.txt                text as copied out of a PDF viewer (pdf.js extraction)
 *   <name>.plain.txt                a hand-typed plain-text resume
 *   <name>.twocol.pdf               a two-column sidebar layout we did not design
 *
 * Skipped unless GEN_RENDERED=1, so it never runs as part of `npm test`.
 */
import { Document, Link, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Packer } from "docx";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { it } from "vitest";
import { buildDocument, type ResumeDocument } from "../lib/document/buildDocument.ts";
import { TEMPLATE_LIST } from "../lib/document/templates.ts";
import { buildDocx } from "../lib/render/docx.ts";
import { preparePdfFonts } from "../lib/render/fonts.ts";
import { ResumePdf } from "../lib/render/ResumePdf.tsx";
import { FIXTURE_FILES, FONT_DIR, loadFixture, REPO_ROOT } from "./fixtures.ts";

const OUT = `${REPO_ROOT}fixtures/rendered/`;

async function pdfToText(buffer: Uint8Array): Promise<string> {
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
  return lines.join("\n") + "\n";
}

/** A plain-text resume as a person might type it in a text editor. */
function plainText(doc: ResumeDocument): string {
  const out: string[] = [doc.name];
  if (doc.headline) out.push(doc.headline);
  out.push(doc.contact.map((c) => c.text).join(" | "), "");
  for (const section of doc.sections) {
    out.push(section.title.toUpperCase());
    for (const e of section.entries) {
      const head = [e.title, e.titleRight].filter(Boolean).join(" | ");
      const sub = [e.subtitle, e.subtitleRight].filter(Boolean).join(" | ");
      if (head) out.push(head);
      if (sub) out.push(sub);
      for (const l of e.lines) out.push(l.label ? `${l.label}: ${l.text}` : l.text);
      for (const b of e.bullets) out.push(`- ${b}`);
      for (const l of e.afterBullets ?? []) out.push(l.label ? `${l.label}: ${l.text}` : l.text);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

const SIDEBAR_TYPES = new Set(["skills", "languages", "certifications"]);

const two = StyleSheet.create({
  page: { flexDirection: "row", fontFamily: "Carlito", fontSize: 10, lineHeight: 1.3, color: "#222" },
  side: { width: "32%", backgroundColor: "#f2f2f2", padding: 22 },
  main: { width: "68%", padding: 26 },
  name: { fontSize: 20, fontWeight: 700 },
  headline: { fontSize: 11, color: "#555", marginBottom: 10 },
  small: { fontSize: 9, marginTop: 2 },
  heading: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4, textTransform: "uppercase" },
  bold: { fontWeight: 700 },
  italic: { fontStyle: "italic" },
  bullet: { flexDirection: "row", marginTop: 1 },
});

/** A two-column layout: contact + short lists in a sidebar, experience in the main column. */
function TwoColumnPdf({ doc }: { doc: ResumeDocument }) {
  const side = doc.sections.filter((s) => SIDEBAR_TYPES.has(currentTypes.get(s.id) ?? ""));
  const main = doc.sections.filter((s) => !side.includes(s));
  const renderSection = (s: ResumeDocument["sections"][number]) => (
    <View key={s.id}>
      <Text style={two.heading}>{s.title}</Text>
      {s.entries.map((e, i) => (
        <View key={i} style={{ marginBottom: 6 }}>
          {e.title ? <Text style={two.bold}>{e.title}</Text> : null}
          {e.subtitle ? <Text style={two.italic}>{e.subtitle}</Text> : null}
          {e.titleRight || e.subtitleRight ? <Text style={two.small}>{[e.titleRight, e.subtitleRight].filter(Boolean).join(" | ")}</Text> : null}
          {e.lines.map((l, j) => (
            <Text key={j}>{l.label ? `${l.label}: ${l.text}` : l.text}</Text>
          ))}
          {e.bullets.map((b, j) => (
            <View key={j} style={two.bullet}>
              <Text style={{ width: 9 }}>•</Text>
              <Text style={{ flex: 1 }}>{b}</Text>
            </View>
          ))}
          {(e.afterBullets ?? []).map((l, j) => (
            <Text key={`a${j}`}>{l.label ? `${l.label}: ${l.text}` : l.text}</Text>
          ))}
        </View>
      ))}
    </View>
  );
  return (
    <Document>
      <Page size="A4" style={two.page}>
        <View style={two.side}>
          <Text style={two.name}>{doc.name}</Text>
          {doc.headline ? <Text style={two.headline}>{doc.headline}</Text> : null}
          {doc.contact.map((c, i) => (
            <Text key={i} style={two.small}>
              {c.href ? <Link src={c.href}>{c.text}</Link> : c.text}
            </Text>
          ))}
          {side.map(renderSection)}
        </View>
        <View style={two.main}>{main.map(renderSection)}</View>
      </Page>
    </Document>
  );
}

// Section ids in the document model come from the resume; their types are looked up here.
let currentTypes = new Map<string, string>();

it.skipIf(!process.env.GEN_RENDERED)("render fixtures for engine import tests", async () => {
  await preparePdfFonts(FONT_DIR);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const file of FIXTURE_FILES) {
    const name = file.replace(/\.json$/, "");
    const resume = loadFixture(file);
    currentTypes = new Map(resume.sections.map((s) => [s.id, s.type]));

    for (const template of TEMPLATE_LIST) {
      const doc = buildDocument({ ...resume, meta: { ...resume.meta, template: template.id } });
      const pdf = await renderToBuffer(<ResumePdf doc={doc} />);
      writeFileSync(`${OUT}${name}.${template.id}.pdf`, pdf);
      writeFileSync(`${OUT}${name}.${template.id}.docx`, await Packer.toBuffer(buildDocx(doc)));
      if (template.id === "classic") writeFileSync(`${OUT}${name}.paste.txt`, await pdfToText(new Uint8Array(pdf)));
    }

    const doc = buildDocument(resume);
    writeFileSync(`${OUT}${name}.plain.txt`, plainText(doc));
    writeFileSync(`${OUT}${name}.twocol.pdf`, await renderToBuffer(<TwoColumnPdf doc={doc} />));
  }
}, 120_000);
