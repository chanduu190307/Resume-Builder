import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MeterBar, ScoreRing, toneFor } from "../../components/motion/ScoreRing.tsx";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs.tsx";
import { easeOut, hasFinePointer, prefersReducedMotion } from "./motion.ts";

describe("motion helpers", () => {
  it("eases from 0 to 1 and clamps outside that range", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5); // fast start
  });

  it("treats an environment without matchMedia as: no reduced-motion request, no fine pointer", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(hasFinePointer()).toBe(false); // so pointer parallax stays off
  });

  it("picks score colours from the same bands as before", () => {
    expect(toneFor(70)).toBe("success");
    expect(toneFor(69)).toBe("warning");
    expect(toneFor(50)).toBe("warning");
    expect(toneFor(49)).toBe("danger");
    expect(toneFor(8, 10)).toBe("success");
    expect(toneFor(0, 0)).toBe("danger");
  });
});

describe("ScoreRing", () => {
  it("shows the real value immediately when it cannot animate, and exposes it to screen readers", () => {
    const html = renderToStaticMarkup(<ScoreRing value={94} caption="/ 100" />);
    expect(html).toContain(">94<");
    expect(html).toContain("/ 100");
    expect(html).toContain('<span class="sr-only">94 out of 100</span>');
    // Ring is fully drawn to 94% (offset = 6% of the circumference).
    const r = (88 - 8) / 2;
    const c = 2 * Math.PI * r;
    expect(html).toContain(`stroke-dashoffset="${c * (1 - 0.94)}"`);
  });

  it("clamps values outside 0..max", () => {
    const html = renderToStaticMarkup(<ScoreRing value={140} max={100} />);
    expect(html).toContain('stroke-dashoffset="0"');
  });

  it("fills meter bars to the right width", () => {
    expect(renderToStaticMarkup(<MeterBar value={23} max={25} />)).toContain("width:92%");
    expect(renderToStaticMarkup(<MeterBar value={5} max={0} />)).toContain("width:0%");
  });
});

describe("SegmentedTabs", () => {
  const tabs = [
    { id: "preview", label: "Preview" },
    { id: "analysis", label: "Analysis" },
    { id: "improve", label: "Improve" },
  ] as const;

  it("renders accessible tabs with only the selected one in the tab order", () => {
    const html = renderToStaticMarkup(<SegmentedTabs label="Side panel" tabs={tabs} value="analysis" onChange={() => undefined} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Side panel"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true" tabindex="0"[^>]*>Analysis</);
    // The pill sits under the second tab.
    expect(html).toContain("translateX(100%)");
  });
});
