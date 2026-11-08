/**
 * PDF layout for every template. Draws a ResumeDocument; makes no content decisions.
 * Output is real, selectable text in reading order (no images, no columns).
 */
import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocEntry, DocLine, ResumeDocument } from "../document/buildDocument.ts";
import { getTemplate, type TemplateStyle } from "../document/templates.ts";

function makeStyles(t: TemplateStyle) {
  return StyleSheet.create({
    page: {
      paddingTop: t.margin,
      paddingBottom: t.margin,
      paddingHorizontal: t.margin,
      fontFamily: t.pdfFont,
      fontSize: t.baseSize,
      lineHeight: t.lineHeight,
      color: t.text,
    },
    header: { textAlign: t.headerAlign, marginBottom: t.sectionGap - 2 },
    name: { fontSize: t.nameSize, fontWeight: 700, lineHeight: 1.15 },
    headline: { fontSize: t.headlineSize, color: t.muted, marginTop: 2 },
    // Contact items are laid out as atomic pieces that wrap between items, never inside one
    // (wrapping inside a long URL made react-pdf insert a stray "-").
    contact: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: t.headerAlign === "center" ? "center" : "flex-start",
      marginTop: 4,
    },
    contactItem: { fontSize: t.smallSize, color: t.muted },
    link: { color: t.muted, textDecoration: "none" },
    section: { marginTop: t.sectionGap },
    heading: {
      fontSize: t.headingSize,
      fontWeight: 700,
      color: t.accent,
      textTransform: t.headingUppercase ? "uppercase" : "none",
      letterSpacing: t.headingUppercase ? 0.6 : 0,
      paddingBottom: 2,
      marginBottom: t.entryGap - 2,
      ...(t.headingStyle === "rule" ? { borderBottomWidth: 0.75, borderBottomColor: "#9a9ca1" } : {}),
    },
    entry: { marginBottom: t.entryGap },
    row: { flexDirection: "row", justifyContent: "space-between" },
    title: { fontWeight: 700, flexGrow: 1, flexShrink: 1, paddingRight: 8 },
    right: { flexShrink: 0, color: t.muted, fontSize: t.smallSize + 0.25 },
    subtitle: { fontStyle: "italic", flexGrow: 1, flexShrink: 1, paddingRight: 8 },
    line: { marginTop: 1 },
    label: { fontWeight: 700 },
    bulletRow: { flexDirection: "row", marginTop: 1.5 },
    bulletMark: { width: 10 },
    bulletText: { flexGrow: 1, flexShrink: 1 },
  });
}

type Styles = ReturnType<typeof makeStyles>;

function LineText({ line, s }: { line: DocLine; s: Styles }) {
  return (
    <Text style={s.line}>
      {line.label ? <Text style={s.label}>{line.label}: </Text> : null}
      {line.href ? (
        <Link src={line.href} style={s.link}>
          {line.text}
        </Link>
      ) : (
        line.text
      )}
    </Text>
  );
}

function Entry({ entry, s }: { entry: DocEntry; s: Styles }) {
  const hasTitleRow = Boolean(entry.title || entry.titleRight);
  const hasSubtitleRow = Boolean(entry.subtitle || entry.subtitleRight);
  return (
    <View style={s.entry}>
      {/* Keep the entry header together and with at least one following line. */}
      <View wrap={false} minPresenceAhead={hasTitleRow ? 24 : 0}>
        {hasTitleRow && (
          <View style={s.row}>
            <Text style={s.title}>{entry.title ?? ""}</Text>
            {entry.titleRight ? <Text style={s.right}>{entry.titleRight}</Text> : null}
          </View>
        )}
        {hasSubtitleRow && (
          <View style={s.row}>
            <Text style={s.subtitle}>{entry.subtitle ?? ""}</Text>
            {entry.subtitleRight ? (
              <Text style={s.right}>
                {entry.subtitleRightHref ? (
                  <Link src={entry.subtitleRightHref} style={s.link}>
                    {entry.subtitleRight}
                  </Link>
                ) : (
                  entry.subtitleRight
                )}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {entry.lines.map((line, i) => (
        <LineText key={i} line={line} s={s} />
      ))}
      {entry.bullets.map((bullet, i) => (
        <View key={i} style={s.bulletRow} wrap={false}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>{bullet}</Text>
        </View>
      ))}
      {(entry.afterBullets ?? []).map((line, i) => (
        <LineText key={`after-${i}`} line={line} s={s} />
      ))}
    </View>
  );
}

export function ResumePdf({ doc }: { doc: ResumeDocument }) {
  const t = getTemplate(doc.template);
  const s = makeStyles(t);
  return (
    <Document
      title={doc.name ? `${doc.name} - Resume` : "Resume"}
      author={doc.name || undefined}
      creator="Resume Builder"
      producer="Resume Builder"
      language="en"
    >
      <Page size={doc.pageSize === "Letter" ? "LETTER" : "A4"} style={s.page}>
        <View style={s.header}>
          {doc.name ? <Text style={s.name}>{doc.name}</Text> : null}
          {doc.headline ? <Text style={s.headline}>{doc.headline}</Text> : null}
          {doc.contact.length > 0 && (
            <View style={s.contact}>
              {doc.contact.map((part, i) => (
                <Text key={i} style={s.contactItem}>
                  {i > 0 ? "  |  " : ""}
                  {part.href ? (
                    <Link src={part.href} style={s.link}>
                      {part.text}
                    </Link>
                  ) : (
                    part.text
                  )}
                </Text>
              ))}
            </View>
          )}
        </View>

        {doc.sections.map((section) => (
          <View key={section.id} style={s.section}>
            <Text style={s.heading} minPresenceAhead={36}>
              {section.title}
            </Text>
            {section.entries.map((entry, i) => (
              <Entry key={i} entry={entry} s={s} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
