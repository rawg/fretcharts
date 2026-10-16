import { describe, it, expect } from "vitest";
import { renderSvg } from "./svg";
import type { ChartLayout } from "../types";

/** A plain E-major-ish nut chord: 6 strings, all fretted or open, no dots offset. */
function nutLayout(): ChartLayout {
  return {
    stringCount: 6,
    startFret: 0,
    visibleFrets: 4,
    fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
    dots: [
      { stringIndex: 1, row: 0 },
      { stringIndex: 2, row: 1 },
      { stringIndex: 3, row: 1 },
    ],
    glyphs: [
      { stringIndex: 0, glyph: "0" },
      { stringIndex: 4, glyph: "0" },
      { stringIndex: 5, glyph: "0" },
    ],
    fingerLabels: [],
    tuningLabels: [],
    fretMarkers: [],
  };
}

function offsetLayout(): ChartLayout {
  return {
    stringCount: 6,
    startFret: 7,
    visibleFrets: 5,
    fretRowLabels: [
      { row: 0, label: "8" },
      { row: 2, label: "10" },
      { row: 4, label: "12" },
    ],
    dots: [
      { stringIndex: 0, row: 0 },
      { stringIndex: 1, row: 1 },
      { stringIndex: 2, row: 2 },
    ],
    glyphs: [
      { stringIndex: 4, glyph: "x" },
      { stringIndex: 5, glyph: "x" },
    ],
    fingerLabels: [],
    tuningLabels: [],
    fretMarkers: [],
  };
}

describe("renderSvg", () => {
  it("renders a basic nut-start layout with the right number of grid lines", () => {
    const svg = renderSvg(nutLayout());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);

    const stringLines = svg.match(/<line[^>]*\/>/g) ?? [];
    // 6 vertical string lines + 5 horizontal fret lines (visibleFrets=4 row
    // boundaries, PLUS the top-of-grid line representing the nut).
    expect(stringLines.length).toBe(6 + 5);
  });

  it("tapers vertical string-line thickness from thickest on the left to thinnest on the right", () => {
    const svg = renderSvg(nutLayout());
    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    // Vertical lines have equal x1/x2; horizontal lines have equal y1/y2.
    const verticalLines = lines.filter((l) => {
      const x1 = /x1="([-\d.]+)"/.exec(l)?.[1];
      const x2 = /x2="([-\d.]+)"/.exec(l)?.[1];
      return x1 === x2;
    });
    expect(verticalLines).toHaveLength(6);

    const widths = verticalLines
      .map((l) => ({
        x: Number(/x1="([-\d.]+)"/.exec(l)?.[1]),
        width: Number(/stroke-width="([-\d.]+)"/.exec(l)?.[1]),
      }))
      .sort((a, b) => a.x - b.x); // left to right

    // Strictly descending left-to-right: leftmost (6th string) thickest,
    // rightmost (1st string) thinnest.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i].width).toBeLessThan(widths[i - 1].width);
    }
    // Leftmost matches the default max, rightmost matches the default min.
    expect(widths[0].width).toBe(3);
    expect(widths[widths.length - 1].width).toBe(1);

    // Horizontal fret lines are unaffected -- they keep the base strokeWidth.
    const horizontalLine = lines.find((l) => /y1="([-\d.]+)"/.exec(l)?.[1] === /y2="([-\d.]+)"/.exec(l)?.[1]);
    expect(/stroke-width="2"/.test(horizontalLine ?? "")).toBe(true);
  });

  it("does not crash and produces non-trivial output for a minimal layout", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain("<svg");
  });

  it("includes fret-row labels (rows 1, 3, 5) for an offset-start layout, plus the top grid line, with no 'fr' suffix", () => {
    const layout = offsetLayout();
    const svg = renderSvg(layout);
    // offsetLayout: startFret=7, visibleFrets=5 -> rows 0/2/4 are frets 8/10/12.
    expect(svg).toContain('class="chord-fret-label chord-fret-label-1"');
    expect(svg).toContain('class="chord-fret-label chord-fret-label-3"');
    expect(svg).toContain('class="chord-fret-label chord-fret-label-5"');
    expect(svg).toMatch(/<text class="chord-fret-label chord-fret-label-1"[^>]*>8<\/text>/);
    expect(svg).toMatch(/<text class="chord-fret-label chord-fret-label-3"[^>]*>10<\/text>/);
    expect(svg).toMatch(/<text class="chord-fret-label chord-fret-label-5"[^>]*>12<\/text>/);
    expect(svg).not.toContain("fr<");
    expect(svg).not.toContain("8fr");

    const lines = svg.match(/<line[^>]*\/>/g) ?? [];
    // 6 vertical string lines + 6 horizontal fret lines (visibleFrets=5 row
    // boundaries, PLUS the top-of-grid line for the fret above what's shown).
    expect(lines.length).toBe(6 + 6);

    // The topmost grid boundary (y = marginTop, i.e. row 0's top edge) must
    // now always be drawn, representing the nut or the fret just above the
    // first one played.
    const horizontalLines = lines.filter((l) => {
      const y1 = /y1="([-\d.]+)"/.exec(l)?.[1];
      const y2 = /y2="([-\d.]+)"/.exec(l)?.[1];
      return y1 === y2; // horizontal lines have equal y1/y2
    });
    const yValues = horizontalLines.map((l) => Number(/y1="([-\d.]+)"/.exec(l)?.[1]));
    const minY = Math.min(...yValues);
    // marginTop default is 60; the top grid boundary line must be drawn there.
    expect(minY).toBe(60);
  });

  it("labels rows 1 and 3 even at the nut (row 5 doesn't apply since visibleFrets=4)", () => {
    const svg = renderSvg(nutLayout()); // startFret=0, visibleFrets=4
    expect(svg).toMatch(/<text class="chord-fret-label chord-fret-label-1"[^>]*>1<\/text>/);
    expect(svg).toMatch(/<text class="chord-fret-label chord-fret-label-3"[^>]*>3<\/text>/);
    expect(svg).not.toContain("chord-fret-label-5");
  });

  it("includes an x glyph for muted strings and an unfilled circle for open strings", () => {
    const svg = renderSvg(nutLayout());
    // Open strings render as an unfilled circle (fill="none"), not text.
    expect(svg).not.toContain(">0<");
    expect(svg).toMatch(/<circle[^>]*fill="none"[^>]*\/>/);

    const svg2 = renderSvg(offsetLayout());
    expect(svg2).toContain(">x<");
  });

  it("sizes the open-string circle so its visual extent (including stroke) matches the x glyph's font-size-relative ink height", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [
        { stringIndex: 0, glyph: "x" },
        { stringIndex: 1, glyph: "0" },
      ],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    const circleMatch = /<circle[^>]*fill="none"[^>]*\/>/.exec(svg);
    const textMatch = /<text[^>]*font-size="([-\d.]+)"[^>]*>x<\/text>/.exec(svg);
    expect(circleMatch).not.toBeNull();
    expect(textMatch).not.toBeNull();

    const radius = Number(/r="([-\d.]+)"/.exec(circleMatch![0])?.[1]);
    const circleStrokeWidth = Number(/stroke-width="([-\d.]+)"/.exec(circleMatch![0])?.[1]);
    const fontSize = Number(textMatch![1]);

    // Same ratio the renderer uses internally (measured empirically against
    // this project's actual font stack -- see X_GLYPH_INK_HEIGHT_RATIO in
    // render/svg.ts): visual diameter (2*radius + stroke) should equal
    // fontSize * that ratio, not the full fontSize.
    const visualDiameter = 2 * radius + circleStrokeWidth;
    const expectedInkHeight = fontSize * (12 / 22);
    expect(visualDiameter).toBeCloseTo(expectedInkHeight, 5);
    expect(visualDiameter).toBeLessThan(fontSize);
  });

  it("includes a dot label positioned on the dot", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [{ stringIndex: 2, row: 1, label: "3" }],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).toContain(">3<");

    // The dot's circle and its label text should share the same center.
    // Attribute order isn't guaranteed (e.g. class= precedes cx=/x=), so
    // match on the class and pull cx/cy or x/y out independently.
    const circleTag = /<circle class="chord-dot[^"]*"[^>]*\/>/.exec(svg)?.[0];
    const textTag = /<text class="chord-dot-label[^"]*"[^>]*>3<\/text>/.exec(svg)?.[0];
    expect(circleTag).toBeDefined();
    expect(textTag).toBeDefined();
    const cx = /cx="([-\d.]+)"/.exec(circleTag!)?.[1];
    const cy = /cy="([-\d.]+)"/.exec(circleTag!)?.[1];
    const tx = /x="([-\d.]+)"/.exec(textTag!)?.[1];
    const ty = /y="([-\d.]+)"/.exec(textTag!)?.[1];
    expect(tx).toBe(cx);
    expect(ty).toBe(cy);
  });

  it("includes the chart label in the output", () => {
    const layout: ChartLayout = {
      ...nutLayout(),
      chartLabel: "E major",
    };
    const svg = renderSvg(layout);
    expect(svg).toContain("E major");
  });

  it("XML-escapes chart labels and dot labels containing special characters", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [{ stringIndex: 0, row: 0, label: "A&B<C>D" }],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
      chartLabel: "Weird <chord> & \"stuff\"",
    };
    const svg = renderSvg(layout);

    // Escaped forms must be present.
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");

    // The raw special characters must not appear unescaped inside text
    // content. Strip out all element tags, leaving only text-node content,
    // and confirm no bare &, <, or > slipped through.
    const textOnly = svg.replace(/<[^>]*>/g, "|");
    expect(textOnly).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it("produces a well-formed-looking SVG string with balanced tags", () => {
    const svg = renderSvg(offsetLayout());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);

    const openTags = svg.match(/<(svg|text)[^>]*>/g) ?? [];
    const closeTags = svg.match(/<\/(svg|text)>/g) ?? [];
    expect(openTags.length).toBe(closeTags.length);

    // Self-closing elements (line, circle) must all be properly terminated.
    const selfClosing = svg.match(/<(line|circle)\b[^>]*>/g) ?? [];
    for (const tag of selfClosing) {
      expect(tag.endsWith("/>")).toBe(true);
    }
  });

  it("keeps all content within the declared width/height (no negative or out-of-bounds glyph position for standard layouts)", () => {
    const svg = renderSvg(nutLayout());
    const widthMatch = /width="([-\d.]+)"/.exec(svg);
    const heightMatch = /height="([-\d.]+)"/.exec(svg);
    expect(widthMatch).not.toBeNull();
    expect(heightMatch).not.toBeNull();
    const width = Number(widthMatch![1]);
    const height = Number(heightMatch![1]);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    const xs = [...svg.matchAll(/[xc]x?="([-\d.]+)"/g)].map((m) => Number(m[1]));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
    }
  });

  it("respects custom options for sizing", () => {
    // marginRight zeroed out to isolate this assertion to columnSpacing/marginX
    // -- fretRowLabels are always non-empty for a normal chart now (rows 1
    // and 3 always get labeled), so rightExtra would otherwise add the
    // default marginRight into the total width too.
    const svg = renderSvg(nutLayout(), {
      columnSpacing: 20,
      dotRadius: 5,
      marginX: 10,
      marginRight: 0,
    });
    const widthMatch = /width="([-\d.]+)"/.exec(svg);
    expect(Number(widthMatch![1])).toBe(10 * 2 + 5 * 20); // marginX*2 + (stringCount-1)*columnSpacing
  });

  it("labels each element with a per-string CSS class keyed by GUITAR STRING NUMBER, not array index", () => {
    // stringIndex 0 (leftmost, array index) = string number 6 (low E);
    // stringIndex 5 (rightmost) = string number 1 (high E).
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [{ stringIndex: 0, row: 0, label: "R" }],
      glyphs: [{ stringIndex: 5, glyph: "0" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);

    expect(svg).toContain('class="chord-string chord-string-6"'); // leftmost vertical line
    expect(svg).toContain('class="chord-string chord-string-1"'); // rightmost vertical line
    expect(svg).toContain('class="chord-dot chord-dot-string-6 chord-dot-shape-circle"'); // dot on leftmost string
    expect(svg).toContain('class="chord-dot-label chord-dot-label-string-6"');
    expect(svg).toContain('class="chord-glyph chord-glyph-open chord-glyph-string-1"'); // open on rightmost
  });

  it("marks the top grid line as chord-fret-nut when starting at the nut, and chord-fret-top (but not chord-fret-nut) otherwise", () => {
    // "chord-fret" (not "chord-string") disambiguates horizontal fret lines
    // from vertical string lines, which also happen to start at y1="60".
    const nutSvg = renderSvg(nutLayout());
    const nutTopLine = /<line class="(chord-fret[^"]*)"/.exec(nutSvg)?.[1];
    expect(nutTopLine).toContain("chord-fret-top");
    expect(nutTopLine).toContain("chord-fret-nut");

    const offsetSvg = renderSvg(offsetLayout());
    const offsetTopLine = /<line class="(chord-fret[^"]*)"/.exec(offsetSvg)?.[1];
    expect(offsetTopLine).toContain("chord-fret-top");
    expect(offsetTopLine).not.toContain("chord-fret-nut");
  });

  it("embeds a provided stylesheet as a <style> element, and it's absent without one", () => {
    const withoutStylesheet = renderSvg(nutLayout());
    expect(withoutStylesheet).not.toContain("<style>");

    const css = ".chord-dot-string-6 { fill: red; stroke: navy; }";
    const withStylesheet = renderSvg(nutLayout(), { stylesheet: css });
    expect(withStylesheet).toContain("<style>");
    expect(withStylesheet).toContain(css);
    // Embedded before the drawn elements, inside a CDATA section (verified
    // against this project's actual sharp/librsvg rasterization pipeline to
    // ensure it's honored, not just present as text).
    expect(withStylesheet.indexOf("<style>")).toBeLessThan(
      withStylesheet.indexOf("<line"),
    );
    expect(withStylesheet).toContain("<![CDATA[");
  });

  it("embeds provided raw SVG markup as a <defs> element, and it's absent without one", () => {
    const withoutDefs = renderSvg(nutLayout());
    expect(withoutDefs).not.toContain("<defs>");

    const defs = '<linearGradient id="g"><stop offset="0%" stop-color="red" /></linearGradient>';
    const withDefs = renderSvg(nutLayout(), { defs });
    expect(withDefs).toContain("<defs>" + defs + "</defs>");
    // Embedded before the drawn elements (and before the stylesheet, which
    // renderSvg also places ahead of the drawn elements), not escaped --
    // it's raw SVG markup, not CDATA-wrapped text like the stylesheet.
    expect(withDefs.indexOf("<defs>")).toBeLessThan(withDefs.indexOf("<line"));
  });

  it("places <defs> before <style> when both are given", () => {
    const svg = renderSvg(nutLayout(), { stylesheet: ".x { fill: red; }", defs: "<linearGradient id=\"g\" />" });
    expect(svg.indexOf("<defs>")).toBeLessThan(svg.indexOf("<style>"));
  });

  it("renders finger position labels centered below the bottom-most fret line, and grows the SVG height to fit them", () => {
    const withoutFingerLabels = renderSvg(nutLayout());
    const heightWithout = Number(/height="([-\d.]+)"/.exec(withoutFingerLabels)?.[1]);

    const layout: ChartLayout = {
      ...nutLayout(),
      fingerLabels: [
        { stringIndex: 2, finger: 2 },
        { stringIndex: 3, finger: 1 },
      ],
    };
    const svg = renderSvg(layout);
    const heightWith = Number(/height="([-\d.]+)"/.exec(svg)?.[1]);
    expect(heightWith).toBeGreaterThan(heightWithout);

    const label2 = /<text class="chord-finger-label chord-finger-label-string-4"[^>]*>2<\/text>/.exec(svg);
    const label1 = /<text class="chord-finger-label chord-finger-label-string-3"[^>]*>1<\/text>/.exec(svg);
    expect(label2).not.toBeNull();
    expect(label1).not.toBeNull();

    // Centered under their string: x matches that string's vertical line.
    const stringLineX = (n: number) =>
      /x1="([-\d.]+)"/.exec(new RegExp(`<line class="chord-string chord-string-${n}"[^>]*/>`).exec(svg)?.[0] ?? "")?.[1];
    expect(/x="([-\d.]+)"/.exec(label2![0])?.[1]).toBe(stringLineX(4));
    expect(/x="([-\d.]+)"/.exec(label1![0])?.[1]).toBe(stringLineX(3));

    // Below the bottom-most fret line (the grid's last horizontal line).
    const fretYs = [...svg.matchAll(/<line class="chord-fret[^"]*"[^>]*y1="([-\d.]+)"/g)].map((m) => Number(m[1]));
    const bottomFretY = Math.max(...fretYs);
    const labelY = Number(/y="([-\d.]+)"/.exec(label2![0])?.[1]);
    expect(labelY).toBeGreaterThan(bottomFretY);
  });

  it("omits the finger-label band entirely when there are no finger labels (unchanged geometry)", () => {
    const svg = renderSvg(nutLayout());
    expect(svg).not.toContain("chord-finger-label");
  });

  it("renders tuning labels above the mute/open glyphs and below the chart label, one per string regardless of fret state", () => {
    const withoutTuningLabels = renderSvg(nutLayout());
    const heightWithout = Number(/height="([-\d.]+)"/.exec(withoutTuningLabels)?.[1]);

    const layout: ChartLayout = {
      ...nutLayout(), // dots at strings 5/4/3 (indices 1,2,3), opens at 6/2/1 (indices 0,4,5)
      chartLabel: "A",
      tuningLabels: [
        { stringIndex: 0, label: "E" },
        { stringIndex: 1, label: "A" },
        { stringIndex: 2, label: "D" },
        { stringIndex: 3, label: "G" },
        { stringIndex: 4, label: "B" },
        { stringIndex: 5, label: "E" },
      ],
    };
    const svg = renderSvg(layout);
    const heightWith = Number(/height="([-\d.]+)"/.exec(svg)?.[1]);
    expect(heightWith).toBeGreaterThan(heightWithout);

    // One label per string, including strings that are dotted (fretted) or
    // glyphed (open) in this layout -- tuning labels don't care either way.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(svg).toMatch(new RegExp(`<text class="chord-tuning-label chord-tuning-label-string-${n}"`));
    }

    const tuningLabelTag = /<text class="chord-tuning-label chord-tuning-label-string-6"[^>]*>E<\/text>/.exec(
      svg,
    );
    const chartTitleTag = /<text class="chord-title"[^>]*>A<\/text>/.exec(svg);
    const glyphTag = /<circle class="chord-glyph chord-glyph-open chord-glyph-string-6"[^>]*\/>/.exec(svg);
    expect(tuningLabelTag).not.toBeNull();
    expect(chartTitleTag).not.toBeNull();
    expect(glyphTag).not.toBeNull();

    const tuningLabelY = Number(/y="([-\d.]+)"/.exec(tuningLabelTag![0])?.[1]);
    const chartTitleY = Number(/y="([-\d.]+)"/.exec(chartTitleTag![0])?.[1]);
    const glyphY = Number(/cy="([-\d.]+)"/.exec(glyphTag![0])?.[1]);

    // Stacking order top to bottom: chart title, then tuning label, then glyph.
    expect(chartTitleY).toBeLessThan(tuningLabelY);
    expect(tuningLabelY).toBeLessThan(glyphY);

    // Centered under its string: same x as that string's vertical line and
    // the same x as its glyph.
    const tuningLabelX = /x="([-\d.]+)"/.exec(tuningLabelTag![0])?.[1];
    const glyphX = /cx="([-\d.]+)"/.exec(glyphTag![0])?.[1];
    expect(tuningLabelX).toBe(glyphX);
  });

  it("omits the tuning-label band entirely when there are no tuning labels (unchanged geometry)", () => {
    const svg = renderSvg(nutLayout());
    expect(svg).not.toContain("chord-tuning-label");
  });

  it("escapes a literal ']]>' inside stylesheet CSS so it can't prematurely close the CDATA section", () => {
    const css = "/* uh oh ]]> */ .chord-dot { fill: red; }";
    const svg = renderSvg(nutLayout(), { stylesheet: css });
    // The raw terminator must not appear unescaped; the standard CDATA
    // splitting trick ("]]" + "]]><![CDATA[" + ">") should be used instead.
    expect(svg).not.toContain("]]> */");
    expect(svg).toContain("]]]]><![CDATA[>");
  });

  it("adds a dot's custom className to both its circle and its label", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [{ stringIndex: 0, row: 0, label: "R", className: "root" }],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).toContain('class="chord-dot chord-dot-string-6 root chord-dot-shape-circle"');
    expect(svg).toContain('class="chord-dot-label chord-dot-label-string-6 root"');
  });

  it("adds an open-string glyph's custom className to its circle", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [{ stringIndex: 1, glyph: "0", className: "root" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).toContain('class="chord-glyph chord-glyph-open chord-glyph-string-5 root"');
  });

  it("never adds a className to a muted glyph (layout.ts already guarantees this, but the renderer shouldn't rely on that alone)", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [{ stringIndex: 0, glyph: "x" }], // no className set, matching layout.ts's guarantee
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    const muteTag = /<text class="chord-glyph chord-glyph-mute[^"]*"[^>]*>x<\/text>/.exec(svg);
    expect(muteTag).not.toBeNull();
    expect(muteTag![0]).not.toContain("root");
  });

  it("renders a label on an open-string glyph, positioned over its circle, fill black (the circle has no fill to contrast a white label against)", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [{ stringIndex: 0, glyph: "0", label: "1" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    const circleMatch = /<circle class="chord-glyph chord-glyph-open chord-glyph-string-6"[^>]*cx="([\d.]+)" cy="([\d.]+)"/.exec(
      svg,
    );
    const labelMatch = /<text class="chord-glyph-label chord-glyph-label-string-6"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*fill="black"[^>]*>1<\/text>/.exec(
      svg,
    );
    expect(circleMatch).not.toBeNull();
    expect(labelMatch).not.toBeNull();
    expect(labelMatch![1]).toBe(circleMatch![1]);
    expect(labelMatch![2]).toBe(circleMatch![2]);
  });

  it("renders no glyph-label element when an open glyph has no label", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [{ stringIndex: 0, glyph: "0" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).not.toContain("chord-glyph-label");
  });

  it("adds an open glyph's custom className to its label too, mirroring the dot/dot-label pairing", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      glyphs: [{ stringIndex: 0, glyph: "0", label: "1", className: "root" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).toContain('class="chord-glyph chord-glyph-open chord-glyph-string-6 root"');
    expect(svg).toContain('class="chord-glyph-label chord-glyph-label-string-6 root"');
  });

  it("never renders a label on a mute glyph, even if one is set (defense in depth, mirroring the className guard above)", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [],
      // A mute glyph with .label set shouldn't exist per the layout contract,
      // but the renderer must not read it even if one sneaks through.
      glyphs: [{ stringIndex: 0, glyph: "x", label: "should not render" }],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    expect(svg).not.toContain("should not render");
    expect(svg).not.toContain("chord-glyph-label");
  });

  it("renders multiple dots on the same string at different rows as distinct circles (scale-chart mode)", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 5,
      fretRowLabels: [{ row: 0, label: "1" }],
      dots: [
        { stringIndex: 0, row: 1, label: "1" },
        { stringIndex: 0, row: 3, label: "b3" },
      ],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    const circles = [...svg.matchAll(/<circle class="chord-dot chord-dot-string-6 chord-dot-shape-circle"[^>]*cy="([\d.]+)"/g)];
    expect(circles).toHaveLength(2);
    expect(circles[0][1]).not.toBe(circles[1][1]); // distinct y positions
    expect(svg).toContain(">1<");
    expect(svg).toContain(">b3<");
  });

  it("XML-escapes a custom className containing a double quote, so it can't break out of the class attribute", () => {
    const layout: ChartLayout = {
      stringCount: 6,
      startFret: 0,
      visibleFrets: 4,
      fretRowLabels: [{ row: 0, label: "1" }, { row: 2, label: "3" }],
      dots: [{ stringIndex: 0, row: 0, className: 'evil" onmouseover="alert(1)' }],
      glyphs: [],
      fingerLabels: [],
      tuningLabels: [],
      fretMarkers: [],
    };
    const svg = renderSvg(layout);
    // The raw quote must not appear unescaped inside the class attribute.
    expect(svg).toContain("&quot;");
    expect(svg).not.toContain('evil" onmouseover');
  });

  describe("background", () => {
    it("includes a full-canvas background rect, transparent by default, before everything else", () => {
      const svg = renderSvg(nutLayout());
      const widthMatch = /^<svg[^>]*width="([\d.]+)"/.exec(svg);
      const heightMatch = /^<svg[^>]*height="([\d.]+)"/.exec(svg);
      const rectMatch = /<rect class="chord-chart-background"[^>]*\/>/.exec(svg);
      expect(rectMatch).not.toBeNull();

      const rect = rectMatch![0];
      expect(/x="([\d.]+)"/.exec(rect)?.[1]).toBe("0");
      expect(/y="([\d.]+)"/.exec(rect)?.[1]).toBe("0");
      expect(/width="([\d.]+)"/.exec(rect)?.[1]).toBe(widthMatch![1]);
      expect(/height="([\d.]+)"/.exec(rect)?.[1]).toBe(heightMatch![1]);
      expect(/fill="([^"]+)"/.exec(rect)?.[1]).toBe("none");

      // Sits behind everything: it's the first drawn element after <style>/<svg>.
      expect(svg.indexOf('class="chord-chart-background"')).toBeLessThan(
        svg.indexOf('class="chord-string'),
      );
    });

    it("is stylable via --stylesheet targeting .chord-chart-background", () => {
      const css = ".chord-chart-background { fill: white; }";
      const svg = renderSvg(nutLayout(), { stylesheet: css });
      expect(svg).toContain(css);
    });
  });

  describe("neck", () => {
    it("includes a neck rect covering just the grid area (not the full canvas), transparent by default", () => {
      const svg = renderSvg(nutLayout());
      const rectMatch = /<rect class="chord-neck"[^>]*\/>/.exec(svg);
      expect(rectMatch).not.toBeNull();

      const rect = rectMatch![0];
      // nutLayout(): default options, no tuning labels -> gridOriginX =
      // marginX (20), gridOriginY = marginTop (60), gridWidth =
      // (stringCount-1)*columnSpacing = 5*34 = 170, gridHeight =
      // visibleFrets*rowHeight = 4*44 = 176.
      expect(/x="([\d.]+)"/.exec(rect)?.[1]).toBe("20");
      expect(/y="([\d.]+)"/.exec(rect)?.[1]).toBe("60");
      expect(/width="([\d.]+)"/.exec(rect)?.[1]).toBe("170");
      expect(/height="([\d.]+)"/.exec(rect)?.[1]).toBe("176");
      expect(/fill="([^"]+)"/.exec(rect)?.[1]).toBe("none");

      // Sits behind the strings/frets/dots, but after the full-canvas
      // background (order in the SVG document == paint order).
      expect(svg.indexOf('class="chord-chart-background"')).toBeLessThan(
        svg.indexOf('class="chord-neck"'),
      );
      expect(svg.indexOf('class="chord-neck"')).toBeLessThan(svg.indexOf('class="chord-string'));
    });

    it("is stylable via --stylesheet targeting .chord-neck, independently of .chord-chart-background", () => {
      const css = ".chord-neck { fill: #8b5a2b; } .chord-chart-background { fill: #222; }";
      const svg = renderSvg(nutLayout(), { stylesheet: css });
      expect(svg).toContain(css);
    });
  });

  describe("fretMarkers", () => {
    it("renders a light grey circle at the computed position, behind the background rect's siblings but after it", () => {
      const layout: ChartLayout = {
        ...nutLayout(),
        fretMarkers: [{ row: 2, betweenIndex: 2.5, kind: "single" }],
      };
      const svg = renderSvg(layout);
      const markerMatch = /<circle class="chord-fret-marker chord-fret-marker-single"[^>]*\/>/.exec(svg);
      expect(markerMatch).not.toBeNull();
      const marker = markerMatch![0];
      expect(/fill="([^"]+)"/.exec(marker)?.[1]).toBe("lightgrey");

      // Position: x = gridOriginX(20) + 2.5*columnSpacing(34) = 105;
      // y = gridOriginY(60) + row(2)*rowHeight(44) + rowHeight/2 = 60+88+22 = 170.
      expect(/cx="([-\d.]+)"/.exec(marker)?.[1]).toBe("105");
      expect(/cy="([-\d.]+)"/.exec(marker)?.[1]).toBe("170");

      // Behind the background's siblings: after chord-chart-background, but
      // before the string lines.
      const bgIndex = svg.indexOf('class="chord-chart-background"');
      const markerIndex = svg.indexOf('class="chord-fret-marker');
      const stringIndex = svg.indexOf('class="chord-string');
      expect(bgIndex).toBeLessThan(markerIndex);
      expect(markerIndex).toBeLessThan(stringIndex);
    });

    it("renders both markers for a double-kind entry with their own class", () => {
      const layout: ChartLayout = {
        ...nutLayout(),
        fretMarkers: [
          { row: 0, betweenIndex: 1.5, kind: "double" },
          { row: 0, betweenIndex: 3.5, kind: "double" },
        ],
      };
      const svg = renderSvg(layout);
      const markers = svg.match(/<circle class="chord-fret-marker chord-fret-marker-double"[^>]*\/>/g) ?? [];
      expect(markers).toHaveLength(2);
    });

    it("is absent entirely when there are no fret markers", () => {
      const svg = renderSvg(nutLayout());
      expect(svg).not.toContain("chord-fret-marker");
    });

    it("is stylable via --stylesheet targeting .chord-fret-marker", () => {
      const css = ".chord-fret-marker { fill: #eeeeee; }";
      const layout: ChartLayout = {
        ...nutLayout(),
        fretMarkers: [{ row: 2, betweenIndex: 2.5, kind: "single" }],
      };
      const svg = renderSvg(layout, { stylesheet: css });
      expect(svg).toContain(css);
    });
  });

  describe("dot shapes", () => {
    it("defaults to a <circle> with a chord-dot-shape-circle class when shape is unset", () => {
      const layout: ChartLayout = { ...nutLayout(), dots: [{ stringIndex: 0, row: 0 }] };
      const svg = renderSvg(layout);
      expect(svg).toMatch(/<circle class="chord-dot chord-dot-string-6 chord-dot-shape-circle"/);
      expect(svg).not.toContain("<rect class=\"chord-dot");
      expect(svg).not.toContain("<polygon class=\"chord-dot");
    });

    it('renders shape: "square" as a <rect> centered on the dot position', () => {
      const layout: ChartLayout = { ...nutLayout(), dots: [{ stringIndex: 0, row: 0, shape: "square" }] };
      const svg = renderSvg(layout);
      const rectTag = /<rect class="chord-dot chord-dot-string-6 chord-dot-shape-square"[^>]*\/>/.exec(svg)?.[0];
      expect(rectTag).toBeDefined();
      const x = Number(/x="([-\d.]+)"/.exec(rectTag!)?.[1]);
      const y = Number(/y="([-\d.]+)"/.exec(rectTag!)?.[1]);
      const width = Number(/width="([-\d.]+)"/.exec(rectTag!)?.[1]);
      const height = Number(/height="([-\d.]+)"/.exec(rectTag!)?.[1]);
      expect(width).toBe(height);
      // Centered: x + width/2 should land back on the dot's cx (20, from nutLayout's stringX(0)).
      expect(x + width / 2).toBeCloseTo(20);
      expect(y + height / 2).toBeCloseTo(82); // gridOriginY (60) + rowHeight/2 (22)
    });

    it('renders shape: "triangle" as an upward-pointing <polygon>', () => {
      const layout: ChartLayout = { ...nutLayout(), dots: [{ stringIndex: 0, row: 0, shape: "triangle" }] };
      const svg = renderSvg(layout);
      const polygonTag = /<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-triangle"[^>]*\/>/.exec(
        svg,
      )?.[0];
      expect(polygonTag).toBeDefined();
      const points = /points="([^"]+)"/.exec(polygonTag!)?.[1].split(" ").map((p) => p.split(",").map(Number));
      expect(points).toHaveLength(3);
      // Top vertex is directly above the other two, which share the same y (a symmetric upward triangle).
      const [top, right, left] = points!;
      expect(top[1]).toBeLessThan(right[1]);
      expect(right[1]).toBeCloseTo(left[1]);
      expect(right[0]).toBeGreaterThan(left[0]);
    });

    it('renders shape: "diamond" as a 4-point <polygon> (a square rotated 45deg)', () => {
      const layout: ChartLayout = { ...nutLayout(), dots: [{ stringIndex: 0, row: 0, shape: "diamond" }] };
      const svg = renderSvg(layout);
      const polygonTag = /<polygon class="chord-dot chord-dot-string-6 chord-dot-shape-diamond"[^>]*\/>/.exec(
        svg,
      )?.[0];
      expect(polygonTag).toBeDefined();
      const points = /points="([^"]+)"/.exec(polygonTag!)?.[1].split(" ").map((p) => p.split(",").map(Number));
      expect(points).toHaveLength(4);
      // Vertices at top/right/bottom/left, each r away from the dot's center (20, 82).
      const [top, right, bottom, left] = points!;
      expect(top).toEqual([20, 82 - 11.5]);
      expect(right).toEqual([20 + 11.5, 82]);
      expect(bottom).toEqual([20, 82 + 11.5]);
      expect(left).toEqual([20 - 11.5, 82]);
    });

    it("adds a custom className alongside the resolved shape class", () => {
      const layout: ChartLayout = {
        ...nutLayout(),
        dots: [{ stringIndex: 0, row: 0, shape: "square", className: "root" }],
      };
      const svg = renderSvg(layout);
      expect(svg).toContain('class="chord-dot chord-dot-string-6 root chord-dot-shape-square"');
    });

    it("is stylable via --stylesheet targeting chord-dot-shape-square", () => {
      const css = ".chord-dot-shape-square { fill: blue; }";
      const layout: ChartLayout = { ...nutLayout(), dots: [{ stringIndex: 0, row: 0, shape: "square" }] };
      const svg = renderSvg(layout, { stylesheet: css });
      expect(svg).toContain(css);
    });
  });

  describe("brackets", () => {
    /** Parses the `d` of each bracket path into its [tickX, y1, lineX, y2]. */
    function bracketGeometry(svg: string): { tickX: number; y1: number; lineX: number; y2: number }[] {
      return [...svg.matchAll(/class="chord-bracket[^"]*" d="M ([\d.]+) ([\d.]+) L ([\d.]+) [\d.]+ L [\d.]+ ([\d.]+)/g)].map(
        (m) => ({ tickX: Number(m[1]), y1: Number(m[2]), lineX: Number(m[3]), y2: Number(m[4]) }),
      );
    }

    it("renders nothing bracket-related, and keeps the original width, when there are none", () => {
      const svg = renderSvg(nutLayout());
      expect(svg).not.toContain("chord-bracket");
      expect(svg).toContain('width="260"');
    });

    it("draws a bracket left of the grid, just inside its fret rows, and shifts the grid right to make room", () => {
      const layout = nutLayout();
      layout.brackets = [{ startFret: 2, endFret: 3, label: "D shape", className: "caged-d", level: 0 }];
      const svg = renderSvg(layout);
      expect(svg).toContain('class="chord-bracket chord-bracket-level-0 caged-d"');
      expect(svg).toContain('class="chord-bracket-label chord-bracket-label-level-0 caged-d"');
      expect(svg).toContain(">D shape</text>");
      expect(svg).toContain("rotate(-90 ");
      // 260 + bracketGap 18 + 1 level * 30
      expect(svg).toContain('width="308"');

      const [g] = bracketGeometry(svg);
      // Grid now starts at x = 20 + 48 = 68; the bracket sits left of it,
      // ticks pointing right toward it.
      expect(g.tickX).toBeLessThan(68);
      expect(g.lineX).toBeLessThan(g.tickX);
      // Fret 2's row spans y 104-148, fret 3's 148-192 (grid top at 60).
      expect(g.y1).toBeGreaterThan(104);
      expect(g.y1).toBeLessThan(104 + 22);
      expect(g.y2).toBeLessThan(192);
      expect(g.y2).toBeGreaterThan(192 - 22);
    });

    it("stacks higher levels further left", () => {
      const layout = nutLayout();
      layout.brackets = [
        { startFret: 1, endFret: 3, label: "a", level: 0 },
        { startFret: 3, endFret: 4, label: "b", level: 1 },
      ];
      const svg = renderSvg(layout);
      const [a, b] = bracketGeometry(svg);
      expect(b.tickX).toBeLessThan(a.lineX);
      expect(svg).toContain('width="338"');
    });

    it("starts a fret-0 bracket in the open-glyph row above the nut", () => {
      const layout = nutLayout();
      layout.brackets = [{ startFret: 0, endFret: 2, label: "E", level: 0 }];
      const [g] = bracketGeometry(renderSvg(layout));
      expect(g.y1).toBeLessThan(60);
    });

    it("positions rows relative to an offset startFret", () => {
      const layout = offsetLayout();
      layout.brackets = [{ startFret: layout.startFret + 1, endFret: layout.startFret + 1, label: "x", level: 0 }];
      const [g] = bracketGeometry(renderSvg(layout));
      // First row of the grid (top at marginTop 60).
      expect(g.y1).toBeGreaterThan(60);
      expect(g.y2).toBeLessThan(60 + 44);
    });
  });
});
