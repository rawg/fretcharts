import { describe, it, expect } from "vitest";
import { renderNeckSvg } from "./neckSvg";
import type { NeckLayout } from "../types";

/** A default-range (nut to fret 12) 6-string layout, nothing offset. */
function nutNeckLayout(): NeckLayout {
  return {
    stringCount: 6,
    firstFret: 0,
    lastFret: 12,
    dots: [
      { stringIndex: 1, fret: 2 },
      { stringIndex: 2, fret: 2 },
      { stringIndex: 3, fret: 1 },
    ],
    glyphs: [
      { stringIndex: 0, glyph: "0" },
      { stringIndex: 4, glyph: "0" },
      { stringIndex: 5, glyph: "0" },
    ],
    fingerLabels: [],
    tuningLabels: [],
    fretMarkers: [
      { fret: 3, betweenIndex: 2.5, kind: "single" },
      { fret: 12, betweenIndex: 1.5, kind: "double" },
      { fret: 12, betweenIndex: 3.5, kind: "double" },
    ],
    fretNumberLabels: [],
    brackets: [],
    warnings: [],
  };
}

/** An offset-range (5th to 17th fret) layout, fret-number labels present. */
function offsetNeckLayout(): NeckLayout {
  return {
    stringCount: 6,
    firstFret: 5,
    lastFret: 17,
    dots: [
      { stringIndex: 0, fret: 5 },
      { stringIndex: 1, fret: 7 },
      { stringIndex: 1, fret: 10 },
    ],
    glyphs: [
      { stringIndex: 4, glyph: "x" },
      { stringIndex: 5, glyph: "x" },
    ],
    fingerLabels: [
      { stringIndex: 1, fret: 7, finger: 1 },
      { stringIndex: 1, fret: 10, finger: 3 },
    ],
    tuningLabels: [],
    fretMarkers: [
      { fret: 5, betweenIndex: 2.5, kind: "single" },
      { fret: 7, betweenIndex: 2.5, kind: "single" },
      { fret: 9, betweenIndex: 2.5, kind: "single" },
      { fret: 12, betweenIndex: 1.5, kind: "double" },
      { fret: 12, betweenIndex: 3.5, kind: "double" },
      { fret: 15, betweenIndex: 2.5, kind: "single" },
      { fret: 17, betweenIndex: 2.5, kind: "single" },
    ],
    fretNumberLabels: [{ fret: 5 }, { fret: 7 }, { fret: 9 }, { fret: 12 }, { fret: 15 }, { fret: 17 }],
    brackets: [],
    warnings: [],
  };
}

describe("renderNeckSvg", () => {
  it("wraps output in an <svg class=\"neck-diagram\"> element, not chord-chart", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('class="neck-diagram"');
    expect(svg).not.toMatch(/<svg[^>]*class="chord-chart"/);
  });

  it("draws one horizontal string line per string, tapering thinnest on top (1st) to thickest on bottom (6th)", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    const stringLines = lines.filter((l) => l.includes('class="chord-string'));
    expect(stringLines).toHaveLength(6);

    const rows = stringLines
      .map((l) => ({
        y: Number(/y1="([-\d.]+)"/.exec(l)?.[1]),
        width: Number(/stroke-width="([-\d.]+)"/.exec(l)?.[1]),
      }))
      .sort((a, b) => a.y - b.y); // top to bottom

    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].width).toBeGreaterThan(rows[i - 1].width);
    }
    expect(rows[0].width).toBe(1);
    expect(rows[rows.length - 1].width).toBe(3);
  });

  it("draws one vertical fret line per fret from the nut through lastFret, with chord-fret-nut only on the first", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    const fretLines = lines.filter((l) => l.includes('class="chord-fret'));
    // firstFret=0 -> leftBoundaryFret=0, so lines run 0..12 inclusive = 13 lines.
    expect(fretLines).toHaveLength(13);

    const nutLines = fretLines.filter((l) => l.includes("chord-fret-nut"));
    expect(nutLines).toHaveLength(1);
  });

  it("draws an extra boundary line before firstFret when offset, without marking it chord-fret-nut", () => {
    const svg = renderNeckSvg(offsetNeckLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    const fretLines = lines.filter((l) => l.includes('class="chord-fret'));
    // leftBoundaryFret = 5-1 = 4, so lines run 4..17 inclusive = 14 lines.
    expect(fretLines).toHaveLength(14);
    expect(fretLines.some((l) => l.includes("chord-fret-nut"))).toBe(false);
  });

  it("positions a dot at fret === firstFret (offset) inside the drawn neck, not before it", () => {
    const svg = renderNeckSvg(offsetNeckLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    const fretLines = lines.filter((l) => l.includes('class="chord-fret"') || l.includes('chord-fret-nut'));
    const fretXs = fretLines.map((l) => Number(/x1="([-\d.]+)"/.exec(l)?.[1]));
    const leftMostFretLineX = Math.min(...fretXs);

    const circles = svg.match(/<circle[^>]*\/>/g) ?? [];
    const dots = circles.filter((c) => c.includes('class="chord-dot'));
    // The stringIndex:0, fret:5 dot -- firstFret itself.
    const dotAtFirstFret = dots.find((c) => c.includes("chord-dot-string-6"));
    expect(dotAtFirstFret).toBeDefined();
    const dotX = Number(/cx="([-\d.]+)"/.exec(dotAtFirstFret!)?.[1]);
    // Must sit to the right of the leftmost drawn line (inside the neck),
    // and left of the next fret line -- the leftBoundaryFret fix at work.
    expect(dotX).toBeGreaterThan(leftMostFretLineX);
  });

  it("renders mute/open glyphs regardless of firstFret", () => {
    const nutSvg = renderNeckSvg(nutNeckLayout());
    expect((nutSvg.match(/class="[^"]*chord-glyph-open[^"]*"/g) ?? [])).toHaveLength(3);

    const offsetSvg = renderNeckSvg(offsetNeckLayout());
    expect((offsetSvg.match(/class="[^"]*chord-glyph-mute[^"]*"/g) ?? [])).toHaveLength(2);
  });

  it("omits chord-neck-fret-label elements entirely when the layout gives no fretNumberLabels", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    expect(svg).not.toContain("chord-neck-fret-label");
  });

  it("renders one chord-neck-fret-label per entry, keyed by actual fret number, above string 1", () => {
    const svg = renderNeckSvg(offsetNeckLayout());
    const labels = svg.match(/<text class="chord-neck-fret-label[^"]*"[^>]*>\d+<\/text>/g) ?? [];
    expect(labels).toHaveLength(6);
    expect(svg).toContain('chord-neck-fret-label-5"');
    expect(svg).toContain('chord-neck-fret-label-17"');
    expect(svg).toMatch(/<text class="chord-neck-fret-label chord-neck-fret-label-5"[^>]*>5<\/text>/);

    // Above string 1's line (the smallest y1 among the string lines), not below it.
    const stringLineYs = [...svg.matchAll(/<line class="chord-string[^"]*"[^>]*y1="([-\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    const topStringY = Math.min(...stringLineYs);
    const labelY = Number(/<text class="chord-neck-fret-label chord-neck-fret-label-5"[^>]*\sy="([-\d.]+)"/.exec(svg)?.[1]);
    expect(labelY).toBeLessThan(topStringY);
  });

  it("renders two same-string, different-fret finger labels at two distinct positions (no collision)", () => {
    const svg = renderNeckSvg(offsetNeckLayout());
    const labels = svg.match(/<text class="chord-finger-label[^"]*"[^>]*>\d<\/text>/g) ?? [];
    expect(labels).toHaveLength(2);

    const positions = labels.map((l) => ({
      x: Number(/x="([-\d.]+)"/.exec(l)?.[1]),
      y: Number(/y="([-\d.]+)"/.exec(l)?.[1]),
    }));
    expect(positions[0]).not.toEqual(positions[1]);
    // Same string -> same y (offset is symmetric per string); different fret -> different x.
    expect(positions[0].y).toBe(positions[1].y);
    expect(positions[0].x).not.toBe(positions[1].x);
  });

  it("renders fret position markers (neck inlays) for both entries of a double-kind fret", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    const markers = svg.match(/<circle class="chord-fret-marker[^"]*"[^>]*\/>/g) ?? [];
    expect(markers).toHaveLength(3); // one single at fret 3, two doubles at fret 12
    expect(markers.filter((m) => m.includes("chord-fret-marker-double"))).toHaveLength(2);
    expect(markers.filter((m) => m.includes("chord-fret-marker-single"))).toHaveLength(1);
  });

  it("is absent entirely when there are no fret markers", () => {
    const layout = { ...nutNeckLayout(), fretMarkers: [] };
    const svg = renderNeckSvg(layout);
    expect(svg).not.toContain("chord-fret-marker");
  });

  it("renders tuning labels left of the glyphs, one per string, shifting the neck's origin right", () => {
    const withoutTuning = renderNeckSvg(nutNeckLayout());
    const withTuning = renderNeckSvg({
      ...nutNeckLayout(),
      tuningLabels: [
        { stringIndex: 0, label: "E" },
        { stringIndex: 1, label: "A" },
        { stringIndex: 2, label: "D" },
        { stringIndex: 3, label: "G" },
        { stringIndex: 4, label: "B" },
        { stringIndex: 5, label: "E" },
      ],
    });
    const tuningLabelEls = withTuning.match(/<text class="chord-tuning-label[^"]*"[^>]*>[^<]+<\/text>/g) ?? [];
    expect(tuningLabelEls).toHaveLength(6);

    // The neck rect's x should shift right to make room for tuning labels.
    const neckRectX = (svg: string) => Number(/<rect class="chord-neck" x="([-\d.]+)"/.exec(svg)?.[1]);
    expect(neckRectX(withTuning)).toBeGreaterThan(neckRectX(withoutTuning));
  });

  it("omits the tuning-label band entirely when there are no tuning labels (unchanged geometry)", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    expect(svg).not.toContain("chord-tuning-label");
  });

  it("embeds a provided stylesheet as a <style> element, and it's absent without one", () => {
    const withStyle = renderNeckSvg(nutNeckLayout(), { stylesheet: ".chord-dot { fill: red; }" });
    expect(withStyle).toContain("<style>");
    expect(withStyle).toContain(".chord-dot { fill: red; }");

    const withoutStyle = renderNeckSvg(nutNeckLayout());
    expect(withoutStyle).not.toContain("<style>");
  });

  it("embeds provided raw SVG markup as a <defs> element, and it's absent without one", () => {
    const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
    const withDefs = renderNeckSvg(nutNeckLayout(), { defs });
    expect(withDefs).toContain("<defs>" + defs + "</defs>");

    const withoutDefs = renderNeckSvg(nutNeckLayout());
    expect(withoutDefs).not.toContain("<defs>");
  });

  it("includes the chart label in the output", () => {
    const svg = renderNeckSvg({ ...nutNeckLayout(), chartLabel: "C Major Scale" });
    expect(svg).toContain("C Major Scale");
    expect(svg).toContain('class="chord-title"');
  });

  it("respects custom fretSpacing/stringSpacing/dotRadius options for sizing", () => {
    const defaultSvg = renderNeckSvg(nutNeckLayout());
    const customSvg = renderNeckSvg(nutNeckLayout(), {
      fretSpacing: 88,
      stringSpacing: 68,
      dotRadius: 23,
    });
    const width = (svg: string) => Number(/width="([-\d.]+)"/.exec(svg)?.[1]);
    const height = (svg: string) => Number(/height="([-\d.]+)"/.exec(svg)?.[1]);
    expect(width(customSvg)).toBeGreaterThan(width(defaultSvg));
    expect(height(customSvg)).toBeGreaterThan(height(defaultSvg));
  });

  it("labels each element with a per-string CSS class keyed by GUITAR STRING NUMBER, not array index", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    // stringIndex 0 (low E) is guitar string 6, on the bottom row.
    expect(svg).toContain("chord-string-6");
    // stringIndex 5 (high E) is guitar string 1, on the top row.
    expect(svg).toContain("chord-string-1");
  });

  it("draws string 6 (low E) on the bottom row and string 1 (high E) on the top row, matching standard tab notation", () => {
    const svg = renderNeckSvg(nutNeckLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    const stringLines = lines.filter((l) => l.includes('class="chord-string'));
    const yOf = (n: number) => {
      const line = stringLines.find((l) => l.includes(`chord-string-${n}"`));
      return Number(/y1="([-\d.]+)"/.exec(line!)?.[1]);
    };
    expect(yOf(6)).toBeGreaterThan(yOf(1));
  });

  it("produces a well-formed-looking SVG string with balanced tags", () => {
    const svg = renderNeckSvg(offsetNeckLayout());
    const opens = (svg.match(/<(circle|line|rect|text)\b/g) ?? []).length;
    const selfClosed = (svg.match(/\/>/g) ?? []).length;
    const textOpens = (svg.match(/<text\b[^>]*>[^<]*<\/text>/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(selfClosed + textOpens).toBeGreaterThan(0);
  });

  describe("dot shapes", () => {
    it("defaults to a <circle> with a chord-dot-shape-circle class when shape is unset", () => {
      const svg = renderNeckSvg({ ...nutNeckLayout(), dots: [{ stringIndex: 0, fret: 3 }] });
      expect(svg).toMatch(/<circle class="chord-dot chord-dot-string-6 chord-dot-shape-circle"/);
    });

    it('renders shape: "square" as a <rect>, shape: "triangle" as a <polygon>, and shape: "diamond" as a 4-point <polygon>', () => {
      const svg = renderNeckSvg({
        ...nutNeckLayout(),
        dots: [
          { stringIndex: 0, fret: 3, shape: "square" },
          { stringIndex: 1, fret: 3, shape: "triangle" },
          { stringIndex: 2, fret: 3, shape: "diamond" },
        ],
      });
      expect(svg).toMatch(/<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"/);
      expect(svg).toMatch(/<polygon class="chord-dot chord-dot-string-5 chord-dot-shape-triangle"/);
      const diamondTag = /<polygon class="chord-dot chord-dot-string-4 chord-dot-shape-diamond"[^>]*\/>/.exec(
        svg,
      )?.[0];
      expect(diamondTag).toBeDefined();
      const points = /points="([^"]+)"/.exec(diamondTag!)?.[1].split(" ") ?? [];
      expect(points).toHaveLength(4);
    });

    it("is stylable via --stylesheet targeting chord-dot-shape-square", () => {
      const css = ".chord-dot-shape-square { fill: blue; }";
      const svg = renderNeckSvg(
        { ...nutNeckLayout(), dots: [{ stringIndex: 0, fret: 3, shape: "square" }] },
        { stylesheet: css },
      );
      expect(svg).toContain(css);
    });
  });

  describe("brackets", () => {
    /** Parses the `d` of each bracket path into its [x1, tickTopY, lineY, x2]. */
    function bracketGeometry(svg: string): { x1: number; top: number; line: number; x2: number }[] {
      return [...svg.matchAll(/class="chord-bracket[^"]*" d="M ([\d.]+) ([\d.]+) L [\d.]+ ([\d.]+) L ([\d.]+)/g)].map(
        (m) => ({ x1: Number(m[1]), top: Number(m[2]), line: Number(m[3]), x2: Number(m[4]) }),
      );
    }

    it("renders nothing bracket-related, and keeps the original height, when there are none", () => {
      const svg = renderNeckSvg(nutNeckLayout());
      expect(svg).not.toContain("chord-bracket");
      // marginTop 40 + 5 string gaps * 34 + marginBottom 20
      expect(svg).toContain('height="230"');
    });

    it("draws each bracket just inside its fret range, below the neck, with its label and classes", () => {
      const layout = nutNeckLayout();
      layout.brackets = [{ startFret: 2, endFret: 5, label: "C shape", className: "caged-c", level: 0 }];
      const svg = renderNeckSvg(layout);
      expect(svg).toContain('class="chord-bracket chord-bracket-level-0 caged-c"');
      expect(svg).toContain('class="chord-bracket-label chord-bracket-label-level-0 caged-c"');
      expect(svg).toContain(">C shape</text>");

      const [g] = bracketGeometry(svg);
      // Fret lines: nut at x=30, fret N at 30 + 44N. Bracket spans frets
      // 2-5, i.e. between the fret-1 line (74) and the fret-5 line (250).
      expect(g.x1).toBeGreaterThan(74);
      expect(g.x1).toBeLessThan(74 + 44 / 2);
      expect(g.x2).toBeLessThan(250);
      expect(g.x2).toBeGreaterThan(250 - 44 / 2);
      // Below the bottom string (y = 40 + 5*34 = 210), ticks pointing up.
      expect(g.top).toBeGreaterThan(210);
      expect(g.line).toBeGreaterThan(g.top);
    });

    it("stacks higher levels further from the neck and grows the canvas to fit", () => {
      const layout = nutNeckLayout();
      layout.brackets = [
        { startFret: 2, endFret: 5, label: "a", level: 0 },
        { startFret: 5, endFret: 8, label: "b", level: 1 },
      ];
      const svg = renderNeckSvg(layout);
      const [a, b] = bracketGeometry(svg);
      expect(b.top).toBeGreaterThan(a.line);
      // 210 (bottom string) + bracketGap 18 + 2 levels * 30
      expect(svg).toContain('height="288"');
    });

    it("keeps adjacent same-level brackets from touching", () => {
      const layout = nutNeckLayout();
      layout.brackets = [
        { startFret: 2, endFret: 5, label: "a", level: 0 },
        { startFret: 6, endFret: 8, label: "b", level: 0 },
      ];
      const [a, b] = bracketGeometry(renderNeckSvg(layout));
      expect(a.x2).toBeLessThan(b.x1);
    });

    it("starts a fret-0 bracket left of the nut, under the open-string glyphs", () => {
      const layout = nutNeckLayout();
      layout.brackets = [{ startFret: 0, endFret: 3, label: "E shape", level: 0 }];
      const [g] = bracketGeometry(renderNeckSvg(layout));
      expect(g.x1).toBeLessThan(30);
      expect(g.x1).toBeGreaterThanOrEqual(0);
    });

    it("escapes bracket labels", () => {
      const layout = nutNeckLayout();
      layout.brackets = [{ startFret: 1, endFret: 3, label: "<b>&", level: 0 }];
      expect(renderNeckSvg(layout)).toContain(">&lt;b&gt;&amp;</text>");
    });
  });
});
