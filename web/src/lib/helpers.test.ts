import { describe, expect, it } from "vitest";
import { splitPastedLines, stripBulletMarker } from "../components/editor/BulletListEditor.tsx";
import { addTags, splitTags } from "../components/ui/TagInput.tsx";
import { resumeFilename } from "./download.ts";

describe("pasting into bullets", () => {
  it("strips common list markers but keeps content", () => {
    expect(stripBulletMarker("• Built an API")).toBe("Built an API");
    expect(stripBulletMarker("- Led a team")).toBe("Led a team");
    expect(stripBulletMarker("* Wrote tests")).toBe("Wrote tests");
    expect(stripBulletMarker("1. First")).toBe("First");
    expect(stripBulletMarker("b) Second")).toBe("Second");
    // Not markers: content that merely starts with these characters.
    expect(stripBulletMarker("-40% latency")).toBe("-40% latency");
    expect(stripBulletMarker("C++ services")).toBe("C++ services");
    expect(stripBulletMarker("2021 hackathon winner")).toBe("2021 hackathon winner");
  });

  it("splits pasted multi-line text into bullets and drops blank lines", () => {
    expect(splitPastedLines("• One\r\n\n- Two\n  3. Three  ")).toEqual(["One", "Two", "Three"]);
  });
});

describe("tag input", () => {
  it("splits on commas, semicolons, newlines and bullets", () => {
    expect(splitTags("React, Node.js; SQL\nGit • Docker,, ")).toEqual(["React", "Node.js", "SQL", "Git", "Docker"]);
  });

  it("adds without case-insensitive duplicates and keeps order", () => {
    expect(addTags(["React", "SQL"], ["react", "Go", "sql", "Rust"])).toEqual(["React", "SQL", "Go", "Rust"]);
  });
});

describe("resumeFilename", () => {
  it("builds a safe, readable filename", () => {
    expect(resumeFilename("Ananya Rao", "pdf")).toBe("Ananya_Rao_Resume.pdf");
    expect(resumeFilename("Sofía Martínez", "docx")).toBe("Sofia_Martinez_Resume.docx");
    expect(resumeFilename("  ", "pdf")).toBe("Resume.pdf");
    expect(resumeFilename("O'Brien / Dev", "pdf")).toBe("O_Brien_Dev_Resume.pdf");
  });
});
